import { Buffer } from "node:buffer"
import { open, readdir, readFile, stat } from "node:fs/promises"
import { basename, join } from "node:path"

import { ExportError, MissingStore, object, string } from "../model.js"
import { compact, compareStrings, trim } from "../text.js"
import { prettyJson, setToolOutput, toolRecord } from "../tools.js"

function contentText(value) {
  if (!Array.isArray(value)) return ""
  return value
    .flatMap((item) => {
      const text = string(object(item)?.text)
      return text !== undefined && trim(text) ? [text] : []
    })
    .join("\n")
}

function shellCommand(command) {
  if (typeof command === "string") return command
  if (!Array.isArray(command)) return ""
  if (
    command.length === 3 &&
    /(^|\/)(ba|z|da|k)?sh$/u.test(String(command[0])) &&
    /^-l?c$/u.test(String(command[1]))
  ) {
    return String(command[2])
  }
  return command.map(String).join(" ")
}

function outputText(value) {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value
    .map((item) => {
      const part = object(item)
      if (typeof part?.text === "string") return part.text
      return part?.type === "input_image" ? "[image]" : ""
    })
    .filter(Boolean)
    .join("\n")
}

// Tool activity in current rollouts: completed items with structured fields.
function eventToolRecords(item) {
  const key = typeof item.id === "string" ? `tool:${item.id}` : undefined
  if (item.type === "CommandExecution") {
    const exit = typeof item.exit_code === "number" ? item.exit_code : undefined
    return [
      toolRecord({
        key,
        name: "shell",
        input: `$ ${shellCommand(item.command)}`,
        output:
          string(item.aggregated_output) ??
          string(item.formatted_output) ??
          [string(item.stdout), string(item.stderr)].filter(Boolean).join("\n"),
        lang: "sh",
        summary: exit ? `(exit ${exit})` : "",
        failed: item.status === "failed" || !!exit,
      }),
    ]
  }
  if (item.type === "FileChange") {
    const changes = Object.entries(object(item.changes) ?? {})
    if (!changes.length) return []
    return [
      toolRecord({
        key,
        name: "edit",
        summary: changes.map(([path]) => path).join(", "),
        input: changes
          .map(([path, value]) => {
            const change = object(value) ?? {}
            const moved = string(change.move_path)
            const header = `${string(change.type) ?? "change"} ${path}${moved ? ` -> ${moved}` : ""}`
            const diff = string(change.unified_diff)
            return diff ? `${header}\n${diff.replace(/\n$/u, "")}` : header
          })
          .join("\n\n"),
        lang: "diff",
        failed: item.status === "failed",
      }),
    ]
  }
  if (item.type === "McpToolCall") {
    const result = object(item.result)
    return [
      toolRecord({
        key,
        name: [item.server, item.tool].filter(Boolean).join("."),
        input: prettyJson(item.arguments),
        lang: "json",
        output:
          outputText(result?.content) ||
          string(item.error) ||
          string(object(item.error)?.message) ||
          "",
        failed: result?.isError === true || item.status === "failed",
      }),
    ]
  }
  if (item.type === "Extension" && item.kind === "web.search") {
    const results = Array.isArray(item.results) ? item.results : []
    return [
      toolRecord({
        key,
        name: "web search",
        summary: string(item.query) ?? "",
        output: results
          .map((value) => {
            const hit = object(value) ?? {}
            return [string(hit.title), string(hit.url)]
              .filter(Boolean)
              .join(" - ")
          })
          .filter(Boolean)
          .join("\n"),
      }),
    ]
  }
  if (item.type === "ImageView" && typeof item.path === "string") {
    return [toolRecord({ key, name: "view image", summary: item.path })]
  }
  return []
}

// Tool activity in older rollouts without item_completed events: model-level
// calls, paired with their outputs by call_id.
function fallbackToolRecords(payload, calls) {
  const callId = string(payload.call_id)
  if (payload.type === "function_call" || payload.type === "custom_tool_call") {
    const namespace = string(payload.namespace)
    const name = string(payload.name) ?? "tool"
    const record = toolRecord({
      key: callId ? `tool:${callId}` : undefined,
      name: namespace ? `${namespace}.${name}` : name,
      input:
        payload.type === "function_call"
          ? prettyJson(payload.arguments)
          : (string(payload.input) ?? ""),
      lang: payload.type === "function_call" ? "json" : "",
    })
    if (callId) calls.set(callId, record)
    return [record]
  }
  if (
    payload.type === "function_call_output" ||
    payload.type === "custom_tool_call_output"
  ) {
    const record = callId ? calls.get(callId) : undefined
    const output = object(payload.output)
    const text = output
      ? outputText(output.content)
      : outputText(payload.output)
    if (record) {
      setToolOutput(record, text, output?.success === false)
      return []
    }
    return text
      ? [
          toolRecord({
            key: callId ? `tool:${callId}` : undefined,
            name: "tool output",
            output: text,
          }),
        ]
      : []
  }
  if (payload.type === "web_search_call") {
    const action = object(payload.action)
    return [
      toolRecord({
        key: string(payload.id) ? `tool:${payload.id}` : undefined,
        name: "web search",
        summary: string(action?.query) ?? "",
      }),
    ]
  }
  return []
}

function eventRecords(row, tools) {
  const payload = object(row.payload)
  const item = object(payload?.item)
  if (row.type !== "event_msg" || payload?.type !== "item_completed" || !item) {
    return []
  }
  if (item.type === "UserMessage") {
    const text = contentText(item.content)
    return trim(text) ? [{ kind: "user", text }] : []
  }
  if (
    item.type === "AgentMessage" &&
    (item.phase === "commentary" || item.phase === "final_answer")
  ) {
    const text = contentText(item.content)
    return trim(text) ? [{ kind: "assistant", text }] : []
  }
  if (item.type === "Reasoning" && Array.isArray(item.summary_text)) {
    return item.summary_text.flatMap((text) =>
      typeof text === "string" && trim(text)
        ? [{ kind: "reasoning", text }]
        : [],
    )
  }
  return tools ? eventToolRecords(item) : []
}

const BLOCKED = [
  "<recommended_plugins>",
  "<environment_context>",
  "<permissions instructions>",
  "<skills_instructions>",
  "<app-context>",
  "# AGENTS.md instructions for ",
]

function fallbackRecords(row, tools, calls) {
  const payload = object(row.payload)
  if (row.type !== "response_item" || !payload) return []
  if (tools) {
    const records = fallbackToolRecords(payload, calls)
    if (records.length || /call/u.test(String(payload.type))) return records
  }
  if (payload.type === "reasoning" && Array.isArray(payload.summary)) {
    return payload.summary.flatMap((value) => {
      const item = object(value)
      const text = string(item?.text)
      return item?.type === "summary_text" && text !== undefined && trim(text)
        ? [{ kind: "reasoning", text }]
        : []
    })
  }
  if (payload.type !== "message") return []
  if (payload.role === "assistant") {
    if (payload.phase !== "commentary" && payload.phase !== "final_answer") {
      return []
    }
    const text = contentText(payload.content)
    return trim(text) ? [{ kind: "assistant", text }] : []
  }
  if (payload.role !== "user") return []
  const kinds = object(
    payload.internal_chat_message_metadata_passthrough,
  )?.content_item_kinds
  if (Array.isArray(kinds) && !kinds.includes("user.text")) return []
  const text = contentText(payload.content)
  return trim(text) && !BLOCKED.some((prefix) => trim(text).startsWith(prefix))
    ? [{ kind: "user", text }]
    : []
}

export function dedupe(records) {
  const seen = new Set()
  return records.filter((record) => {
    const key = record.key ?? compact(record.text)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function placeTrailingReasoning(records) {
  let start = records.length
  while (start > 0 && records[start - 1]?.kind === "reasoning") start--
  if (
    start === records.length ||
    start === 0 ||
    records[start - 1]?.kind !== "assistant"
  ) {
    return records
  }
  return [
    ...records.slice(0, start - 1),
    ...records.slice(start),
    records[start - 1],
  ]
}

// Reads only the first `size` bytes of an open file, so data appended while
// reading cannot extend the parse.
export async function* boundedLines(file, size) {
  let offset = 0
  let pieces = []
  while (offset < size) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, size - offset))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
    if (!bytesRead) {
      throw new ExportError("A Codex rollout was truncated while reading")
    }
    offset += bytesRead
    let start = 0
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] !== 10) continue
      pieces.push(buffer.subarray(start, i + 1))
      yield (pieces.length === 1 ? pieces[0] : Buffer.concat(pieces)).toString(
        "utf8",
      )
      pieces = []
      start = i + 1
    }
    if (start < bytesRead) pieces.push(buffer.subarray(start, bytesRead))
  }
  if (pieces.length) yield Buffer.concat(pieces).toString("utf8")
}

export async function parseCodex(path, { tools = false } = {}) {
  let file
  try {
    file = await open(path, "r")
    const initial = await file.stat()
    const stem = basename(path, ".jsonl")
    let id = stem
    let source = ""
    let parent = ""
    let startedAt = ""
    let directory = ""
    let sawMeta = false
    let sawUserEvent = false
    const events = []
    const fallback = []
    const calls = new Map()
    for await (const line of boundedLines(file, initial.size)) {
      let row
      try {
        row = object(JSON.parse(line))
      } catch {
        continue
      }
      if (!row) continue
      if (!startedAt && typeof row.timestamp === "string") {
        startedAt = row.timestamp
      }
      const payload = object(row.payload)
      if (row.type === "session_meta" && !sawMeta && payload) {
        sawMeta = true
        const candidate = payload.id || payload.thread_id
        if (typeof candidate === "string" && candidate) id = candidate
        if (
          typeof payload.thread_source === "string" &&
          payload.thread_source
        ) {
          source = payload.thread_source
        }
        if (
          typeof payload.parent_thread_id === "string" &&
          payload.parent_thread_id
        ) {
          parent = payload.parent_thread_id
        }
        if (typeof payload.timestamp === "string" && payload.timestamp) {
          startedAt = payload.timestamp
        }
        if (typeof payload.cwd === "string") directory = payload.cwd
        if (
          !source &&
          object(payload.source) &&
          "subagent" in object(payload.source)
        ) {
          source = "subagent"
        }
        if (source === "subagent" || (!source && parent && parent !== id)) {
          return undefined
        }
      }
      for (const record of eventRecords(row, tools)) {
        if (record.kind === "user") {
          sawUserEvent = true
          fallback.length = 0
        }
        events.push(record)
      }
      if (!sawUserEvent) fallback.push(...fallbackRecords(row, tools, calls))
    }
    if ((await file.stat()).size < initial.size) return undefined
    const records = dedupe(sawUserEvent ? events : fallback)
    if (!records.length) return undefined
    return {
      provider: "codex",
      id,
      title: "",
      directory,
      updatedAt: initial.mtimeMs,
      records,
      paths: [path],
      startedAt,
      source: source || (parent && parent !== id ? "subagent" : "user"),
    }
  } catch (error) {
    if (
      error instanceof ExportError ||
      (error instanceof Error && "code" in error)
    ) {
      return undefined
    }
    throw error
  } finally {
    await file?.close()
  }
}

export async function rolloutPaths(root) {
  const result = []
  async function walk(directory, recursive) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return
      }
      throw error
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (recursive && entry.isDirectory()) await walk(path, true)
      else if (!entry.isDirectory() && entry.name.endsWith(".jsonl")) {
        result.push(path)
      }
    }
  }
  await walk(join(root, "sessions"), true)
  await walk(join(root, "archived_sessions"), false)
  return result
}

export function mergeCodex(fragments) {
  if (!fragments.length) return undefined
  const ordered = [...fragments].sort(
    (a, b) =>
      compareStrings(
        a.startedAt || basename(a.paths[0]),
        b.startedAt || basename(b.paths[0]),
      ) || compareStrings(a.paths[0], b.paths[0]),
  )
  const newest = fragments.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
  const records = placeTrailingReasoning(
    dedupe(ordered.flatMap((chat) => chat.records)),
  )
  if (!records.length) return undefined
  const directory =
    [...ordered].reverse().find((chat) => chat.directory)?.directory ?? ""
  return {
    ...ordered[0],
    directory,
    records,
    updatedAt: newest.updatedAt,
    paths: ordered.flatMap((chat) => chat.paths ?? []),
  }
}

// Chat names live in session_index.jsonl; a rename appends a new line, so the
// last line for an ID wins. Chats Codex never named have no title.
export async function codexTitles(root) {
  let raw
  try {
    raw = await readFile(join(root, "session_index.jsonl"), "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return new Map()
    throw new ExportError("Could not read Codex chat names", { cause: error })
  }
  const titles = new Map()
  for (const line of raw.split("\n")) {
    let row
    try {
      row = object(JSON.parse(line))
    } catch {
      continue
    }
    const id = string(row?.id)
    const name = string(row?.thread_name)
    if (id && name !== undefined) titles.set(id, trim(name))
  }
  return titles
}

export async function loadCodex(root, options = {}) {
  if (!(await stat(root).catch(() => undefined))?.isDirectory()) {
    throw new MissingStore(`Codex directory not found: ${root}`)
  }
  const titles = await codexTitles(root)
  const groups = new Map()
  for (const path of await rolloutPaths(root)) {
    const fragment = await parseCodex(path, options)
    if (!fragment) continue
    const group = groups.get(fragment.id) ?? []
    group.push(fragment)
    groups.set(fragment.id, group)
  }
  return [...groups.values()]
    .flatMap((group) => {
      const chat = mergeCodex(group)
      return chat && chat.source !== "subagent"
        ? [{ ...chat, title: titles.get(chat.id) ?? "" }]
        : []
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

// Rereads the selected chat before export. Fragments may have been moved to
// the archive or appended while the picker was open; the guard (every record
// seen when indexing) rejects a refresh that would lose previously seen text.
export async function refreshCodex(root, id, guard, options = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await rolloutPaths(root)
    const fragments = []
    for (const path of before) {
      const fragment = await parseCodex(path, options)
      if (fragment?.id === id) fragments.push(fragment)
    }
    const after = new Set(await rolloutPaths(root))
    if (
      before.length !== after.size ||
      before.some((path) => !after.has(path))
    ) {
      continue
    }
    const chat = mergeCodex(fragments)
    if (!chat || chat.source === "subagent") continue
    const actual = new Set(chat.records.map((record) => compact(record.text)))
    if (guard.every((key) => actual.has(key))) {
      return { ...chat, title: (await codexTitles(root)).get(id) ?? "" }
    }
  }
  throw new ExportError(
    "The selected Codex chat changed or could not be read in full. Reopen the picker and try again.",
  )
}
