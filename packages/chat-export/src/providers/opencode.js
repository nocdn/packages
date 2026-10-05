import { posix } from "node:path"

import { ExportError, object, UnsupportedFormat } from "../model.js"
import { terminalText, trim } from "../text.js"
import { prettyJson, toolRecord } from "../tools.js"
import { openReadDatabase } from "./sqlite.js"

const REQUIRED = {
  session: ["id", "parent_id", "title", "directory", "time_updated", "revert"],
  message: ["id", "session_id", "time_created", "data"],
  part: ["id", "message_id", "session_id", "data"],
}

const INVISIBLE = new Set([
  "tool",
  "subtask",
  "agent",
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "retry",
  "compaction",
])

export const MESSAGE_BATCH_SIZE = 256

const PART_FIELDS = [
  "$.type",
  "$.text",
  "$.synthetic",
  "$.ignored",
  "$.metadata.compaction_continue",
  "$.mime",
  "$.filename",
  "$.source.path",
]
const TOOL_FIELDS = [
  "$.tool",
  "$.callID",
  "$.state.status",
  "$.state.title",
  "$.state.input",
  "$.state.output",
  "$.state.error",
]

function openCodeTool({
  partId,
  name,
  callId,
  status,
  title,
  input,
  output,
  error,
}) {
  const args = object(input) ?? {}
  const shell = name === "bash" && typeof args.command === "string"
  return toolRecord({
    key: `tool:${typeof callId === "string" && callId ? callId : partId}`,
    name: typeof name === "string" && name ? name : "tool",
    summary: [
      shell ? "" : typeof title === "string" ? title : "",
      status === "completed" || status === "error" ? "" : `(${status})`,
    ]
      .filter(Boolean)
      .join(" "),
    input: shell ? `$ ${args.command}` : prettyJson(input),
    lang: shell ? "sh" : "json",
    output:
      typeof output === "string" && output
        ? output
        : typeof error === "string"
          ? error
          : typeof object(error)?.message === "string"
            ? error.message
            : prettyJson(error),
    failed: status === "error",
  })
}

function attachmentLabel(filename, sourcePath, mime) {
  const label =
    filename ||
    (typeof sourcePath === "string" ? posix.basename(sourcePath) : "attachment")
  return `[Attachment: ${terminalText(String(label))} (${terminalText(String(mime || "file"))})]`
}

function text(row, key) {
  const value = row[key]
  if (typeof value !== "string") {
    throw new ExportError(`Unsupported OpenCode ${key} value`)
  }
  return value
}

function hasTable(db, name) {
  return !!db.get("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?", [
    name,
  ])
}

function columns(db, table) {
  return new Set(db.all(`PRAGMA table_info("${table}")`).map((row) => row.name))
}

// OpenCode 1.18.16-1.18.25 (and some betas) also wrote a newer layout:
// `session_v2` plus one `session_message` row per message. Messages written to
// both layouts share their IDs; some were written to only one of them. When
// the newer tables exist and are shaped as expected, sessions are read from
// the union of both layouts.
const V2_COLUMNS = {
  session_v2: [
    "id",
    "parent_id",
    "title",
    "slug",
    "directory",
    "time_updated",
    "revert",
  ],
  session_message: ["id", "session_id", "type", "seq", "time_created", "data"],
}

function v2Layout(db) {
  if (!hasTable(db, "session_message")) return false
  for (const [table, required] of Object.entries(V2_COLUMNS)) {
    if (!hasTable(db, table)) return false
    const names = columns(db, table)
    if (required.some((column) => !names.has(column))) return false
  }
  return true
}

function metadata(row) {
  if (typeof row.time_updated !== "number") {
    throw new ExportError("Invalid OpenCode session timestamp")
  }
  return {
    provider: "opencode",
    id: text(row, "id"),
    title: text(row, "title"),
    directory: text(row, "directory"),
    updatedAt: row.time_updated,
  }
}

export async function openOpenCode(path) {
  const db = await openReadDatabase(path)
  try {
    for (const [table, columns] of Object.entries(REQUIRED)) {
      const names = new Set(
        db.all(`PRAGMA table_info("${table}")`).map((row) => row.name),
      )
      const missing = columns.filter((column) => !names.has(column))
      if (missing.length) {
        throw new ExportError(
          `Unsupported OpenCode schema: ${table} is missing ${missing.join(", ")}`,
        )
      }
    }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function listOpenCode(db) {
  if (!v2Layout(db)) {
    return db
      .all(
        "SELECT id, title, directory, time_updated FROM session WHERE parent_id IS NULL ORDER BY time_updated DESC, id DESC",
      )
      .map(metadata)
  }
  return db
    .all(
      `SELECT s.id, s.title, s.directory, max(s.time_updated, coalesce(v.time_updated, 0)) AS time_updated
         FROM session s LEFT JOIN session_v2 v ON v.id = s.id
         WHERE s.parent_id IS NULL
       UNION ALL
       SELECT v.id, coalesce(v.title, v.slug, '') AS title, v.directory, v.time_updated
         FROM session_v2 v
         WHERE v.parent_id IS NULL AND NOT EXISTS (SELECT 1 FROM session s WHERE s.id = v.id)
       ORDER BY time_updated DESC, id DESC`,
    )
    .map(metadata)
}

function v2Records(row, reasoning, tools) {
  const messageId = text(row, "id")
  let data
  try {
    data = object(JSON.parse(text(row, "data")))
  } catch {
    data = undefined
  }
  if (!data)
    throw new ExportError(`Invalid OpenCode message data in ${messageId}`)
  const records = []
  const push = (kind, body, index) => {
    if (typeof body !== "string") {
      throw new ExportError(
        `Invalid text in ${messageId}; refusing a partial export`,
      )
    }
    if (trim(body)) {
      records.push({
        kind,
        text: body,
        messageId,
        partId: `${messageId}:${index}`,
      })
    }
  }
  if (row.type === "user") {
    push("user", data.text ?? "", 0)
    const files = Array.isArray(data.files) ? data.files : []
    files.forEach((file, index) => {
      const value = object(file) ?? {}
      push(
        "user",
        attachmentLabel(value.name, object(value.source)?.path, value.mime),
        index + 1,
      )
    })
    return records
  }
  if (row.type !== "assistant") return records
  if (!Array.isArray(data.content)) {
    throw new UnsupportedFormat(
      `Unsupported OpenCode message content in ${messageId}; refusing a partial export`,
    )
  }
  data.content.forEach((value, index) => {
    const item = object(value) ?? {}
    if (item.type === "text") push("assistant", item.text, index)
    else if (item.type === "reasoning") {
      if (reasoning) push("reasoning", item.text, index)
    } else if (item.type === "tool") {
      if (!tools) return
      const state = object(item.state) ?? {}
      const output = Array.isArray(state.content)
        ? state.content
            .map((part) => object(part)?.text)
            .filter((part) => typeof part === "string")
            .join("\n")
        : undefined
      records.push({
        ...openCodeTool({
          partId: `${messageId}:${index}`,
          name: item.name,
          callId: item.id,
          status: state.status,
          title: state.title,
          input: state.input,
          output,
          error: state.error,
        }),
        messageId,
        partId: `${messageId}:${index}`,
      })
    } else {
      throw new UnsupportedFormat(
        `Unsupported OpenCode content type in ${messageId}; refusing a partial export`,
      )
    }
  })
  return records
}

export function readOpenCode(db, id, reasoning = true, tools = false) {
  db.transaction("BEGIN")
  try {
    let session = db.get(
      "SELECT id, parent_id, title, directory, time_updated, revert FROM session WHERE id=?",
      [id],
    )
    const hasSessionMessages =
      hasTable(db, "session_message") &&
      !!db.get("SELECT 1 FROM session_message WHERE session_id=? LIMIT 1", [id])
    const v2 = v2Layout(db)
    if (hasSessionMessages && !v2) {
      throw new UnsupportedFormat(
        `Session ${id} uses an unrecognized newer message format; refusing a partial export`,
      )
    }
    const v2Session = v2
      ? db.get(
          "SELECT id, parent_id, coalesce(title, slug, '') AS title, directory, time_updated, revert FROM session_v2 WHERE id=?",
          [id],
        )
      : undefined
    if (!session && v2Session) session = { ...v2Session, revert: null }
    if (!session) throw new ExportError(`Session no longer exists: ${id}`)
    if (
      session.parent_id !== null ||
      (v2Session && v2Session.parent_id !== null)
    ) {
      throw new ExportError(`Child/subagent sessions are excluded: ${id}`)
    }
    if (v2Session) {
      session = {
        ...session,
        time_updated: Math.max(session.time_updated, v2Session.time_updated),
      }
      if (v2Session.revert && v2Session.revert !== "{}") {
        throw new UnsupportedFormat(
          `Session ${id} has a revert in the newer message format; refusing a partial export`,
        )
      }
    }
    let revert = {}
    if (session.revert) {
      const parsed =
        typeof session.revert === "string"
          ? object(JSON.parse(session.revert))
          : undefined
      if (
        !parsed ||
        (Object.keys(parsed).length > 0 && typeof parsed.messageID !== "string")
      ) {
        throw new ExportError(`Invalid revert boundary in ${id}`)
      }
      revert = parsed
    }
    let messages = db.all(
      "SELECT id, time_created, json_extract(data, '$.role') AS role, json_type(data, '$.summary') AS summary_type FROM message WHERE session_id=? ORDER BY time_created, id",
      [id],
    )
    // Messages that exist only in the newer layout, in the same order.
    let newer = []
    if (hasSessionMessages) {
      const known = new Set(messages.map((message) => message.id))
      newer = db
        .all(
          "SELECT id, type, time_created, data FROM session_message WHERE session_id=? ORDER BY seq",
          [id],
        )
        // Other row types (synthetic, compaction, system, idle, and so on)
        // are notices and session events, never conversation text.
        .filter(
          (row) =>
            (row.type === "user" || row.type === "assistant") &&
            !known.has(row.id),
        )
      if (newer.length && revert.messageID) {
        throw new UnsupportedFormat(
          `Session ${id} mixes a revert with newer-format messages; refusing a partial export`,
        )
      }
    }
    if (revert.messageID) {
      const boundary = messages.findIndex((row) => row.id === revert.messageID)
      if (boundary < 0) {
        throw new ExportError(
          `Revert boundary missing from ${id}; refusing a partial export`,
        )
      }
      messages = messages.slice(0, boundary + (revert.partID ? 1 : 0))
    }
    messages = messages.filter(
      (message) =>
        message.role === "user" ||
        (message.role === "assistant" &&
          (message.summary_type !== "true" || message.id === revert.messageID)),
    )
    const fields = tools ? [...PART_FIELDS, ...TOOL_FIELDS] : PART_FIELDS
    const projection = fields.map((field) => `'${field}'`).join(", ")
    const grouped = new Map()
    for (let start = 0; start < messages.length; start += MESSAGE_BATCH_SIZE) {
      const batch = messages.slice(start, start + MESSAGE_BATCH_SIZE)
      const rows = db.all(
        `SELECT id, message_id, session_id, json_extract(data, ${projection}) AS visible FROM part WHERE message_id IN (${batch.map(() => "?").join(",")}) ORDER BY message_id, id`,
        batch.map((message) => text(message, "id")),
      )
      for (const row of rows) {
        const key = text(row, "message_id")
        const parts = grouped.get(key) ?? []
        parts.push(row)
        grouped.set(key, parts)
      }
    }
    const ordered = newer.length
      ? [...messages, ...newer.map((row) => ({ ...row, newer: true }))].sort(
          (a, b) =>
            a.time_created - b.time_created ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
      : messages
    const records = []
    for (const message of ordered) {
      if (message.newer) {
        records.push(...v2Records(message, reasoning, tools))
        continue
      }
      const messageId = text(message, "id")
      const atRevert = messageId === revert.messageID
      const parts = grouped.get(messageId) ?? []
      if (atRevert && !parts.some((part) => part.id === revert.partID)) {
        throw new ExportError(`Reverted part missing from ${messageId}`)
      }
      for (const part of parts) {
        if (atRevert && part.id === revert.partID) break
        if (part.session_id !== id) {
          throw new ExportError(
            `Part ${String(part.id)} belongs to a different session`,
          )
        }
        const visible = JSON.parse(text(part, "visible"))
        if (!Array.isArray(visible) || visible.length !== fields.length) {
          throw new ExportError("Invalid OpenCode part projection")
        }
        const [
          kind,
          body,
          synthetic,
          ignored,
          continuation,
          mime,
          filename,
          sourcePath,
          ...toolFields
        ] = visible
        if (
          (message.role === "assistant" && message.summary_type === "true") ||
          synthetic ||
          ignored ||
          continuation
        ) {
          continue
        }
        if (kind === "tool" && tools && message.role === "assistant") {
          const [name, callId, status, title, input, output, error] = toolFields
          records.push({
            ...openCodeTool({
              partId: text(part, "id"),
              name,
              callId,
              status,
              title,
              input,
              output,
              error,
            }),
            messageId,
            partId: text(part, "id"),
          })
          continue
        }
        if (typeof kind === "string" && INVISIBLE.has(kind)) continue
        if (
          kind === "reasoning" &&
          (!reasoning || message.role !== "assistant")
        ) {
          continue
        }
        let content = body
        if (kind === "file") {
          content = attachmentLabel(filename, sourcePath, mime)
        } else if (kind !== "text" && kind !== "reasoning") {
          throw new UnsupportedFormat(
            `Unsupported part type in ${String(part.id)}; refusing a partial export`,
          )
        }
        if (typeof content !== "string") {
          throw new ExportError(
            `Invalid text in ${String(part.id)}; refusing a partial export`,
          )
        }
        if (trim(content)) {
          records.push({
            kind: kind === "reasoning" ? "reasoning" : message.role,
            text: content,
            messageId,
            partId: text(part, "id"),
          })
        }
      }
    }
    return { ...metadata(session), records }
  } finally {
    db.transaction("ROLLBACK")
  }
}
