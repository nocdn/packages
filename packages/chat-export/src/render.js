import {
  compact,
  dateLabel,
  oneLine,
  recordText,
  transcript,
  trim,
  validUnicode,
  visibleRecords,
} from "./text.js"
import { toolTitle } from "./tools.js"

export const FORMATS = ["text", "markdown", "json"]

const PROVIDER_NAMES = { codex: "Codex", opencode: "OpenCode" }
const PREVIEW_LIMIT = 4000
const PREVIEW_RECORD_LIMIT = 800

export function providerName(provider) {
  return PROVIDER_NAMES[provider] ?? provider
}

export function renderExport(chat, format = "text", view = {}) {
  if (format === "markdown") return markdownTranscript(chat, view)
  if (format === "json") return jsonTranscript(chat, view)
  return transcript(chat, view)
}

function chatTitle(chat) {
  if (chat.title) return oneLine(chat.title)
  const first = chat.records.find((record) => record.kind === "user")
  if (!first) return chat.id
  const words = Array.from(compact(oneLine(first.text)))
  return words.length > 80 ? `${words.slice(0, 80).join("")}…` : words.join("")
}

function nonEmpty(chat, view) {
  return visibleRecords(chat, view).flatMap((record) => {
    const text = recordText(chat, record)
    return trim(text) ? [{ record, text }] : []
  })
}

// A fence longer than any backtick run in the body, so code blocks inside
// messages or tool output cannot close it early.
function fence(body, lang = "") {
  const longest = Math.max(
    0,
    ...Array.from(body.matchAll(/`+/gu), (match) => match[0].length),
  )
  const ticks = "`".repeat(Math.max(3, longest + 1))
  return `${ticks}${lang}\n${body.replace(/\n+$/u, "")}\n${ticks}`
}

function escapeHtml(value) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
}

function details(summary, body) {
  return `<details>\n<summary>${escapeHtml(oneLine(summary))}</summary>\n\n${body}\n\n</details>`
}

function toolBlock(tool) {
  const parts = []
  if (tool.input) parts.push(fence(tool.input, tool.lang))
  if (tool.output) parts.push(`Output:\n\n${fence(tool.output, "text")}`)
  const title = `Tool: ${toolTitle(tool)}${tool.failed ? " (failed)" : ""}`
  return parts.length ? details(title, parts.join("\n\n")) : `*${title}*`
}

export function markdownTranscript(chat, view = {}) {
  const blocks = [`# ${chatTitle(chat)}`]
  const meta = [
    `- **Source:** ${providerName(chat.provider)}`,
    `- **Session:** \`${chat.id}\``,
  ]
  if (chat.directory) meta.push(`- **Directory:** \`${chat.directory}\``)
  meta.push(`- **Updated:** ${dateLabel(chat.updatedAt)}`)
  blocks.push(meta.join("\n"), "---")

  const items = nonEmpty(chat, view)
  let section
  let previous
  for (let i = 0; i < items.length; i++) {
    const { record, text } = items[i]
    const group = record.kind === "user" ? "user" : "assistant"
    const sameMessage =
      chat.provider === "opencode" && previous?.messageId === record.messageId
    if (group !== section || (group === "user" && !sameMessage)) {
      blocks.push(group === "user" ? "## User" : "## Assistant")
      section = group
    }
    if (record.kind === "reasoning") {
      const texts = [text]
      while (items[i + 1]?.record.kind === "reasoning")
        texts.push(items[++i].text)
      blocks.push(details("Reasoning", texts.join("\n\n")))
      previous = items[i].record
      continue
    }
    blocks.push(record.kind === "tool" ? toolBlock(record.tool) : text)
    previous = record
  }
  return validUnicode(blocks.join("\n\n") + "\n")
}

export function jsonTranscript(chat, view = {}) {
  const updated = new Date(chat.updatedAt)
  const value = {
    provider: chat.provider,
    id: chat.id,
    title: chatTitle(chat),
    directory: chat.directory,
    updatedAt: Number.isFinite(updated.getTime())
      ? updated.toISOString()
      : null,
    records: nonEmpty(chat, view).map(({ record, text }) => ({
      role: record.kind,
      text,
      ...(record.tool ? { tool: record.tool } : {}),
    })),
  }
  return validUnicode(JSON.stringify(value, null, 2) + "\n")
}

// Keep newlines, but never pass terminal control sequences from chat text
// through to the preview.
function previewSafe(value) {
  return (
    value
      .replace(/\r\n?/gu, "\n")
      .replace(/\t/gu, "  ")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f‪-‮⁦-⁩]/gu, " ")
  )
}

function clip(value, limit) {
  const characters = Array.from(value)
  return characters.length > limit
    ? `${characters.slice(0, limit).join("")}…`
    : value
}

// A bounded, structured preview of the start of a chat. It travels with each
// picker entry, so previews never reread the chat stores.
export function previewData(chat, view = {}) {
  const blocks = []
  let used = 0
  let more = false
  for (const { record, text } of nonEmpty(chat, view)) {
    if (used >= PREVIEW_LIMIT) {
      more = true
      break
    }
    const body = clip(
      previewSafe(text).replace(/\n{3,}/gu, "\n\n"),
      Math.min(PREVIEW_RECORD_LIMIT, PREVIEW_LIMIT - used),
    )
    used += body.length
    blocks.push({ kind: record.kind, text: body })
  }
  const header = [chatTitle(chat)]
  const facts = [providerName(chat.provider), dateLabel(chat.updatedAt)]
  if (chat.directory) facts.push(chat.directory)
  header.push(facts.join("  ·  "))
  return {
    header: header.map((line) => previewSafe(oneLine(line))),
    blocks,
    more,
  }
}

const LABELS = {
  user: ["You", "1;36"],
  assistant: ["Assistant", "1;32"],
  reasoning: ["Reasoning", "2"],
  tool: ["Tool", "1;33"],
}

export function renderPreview(data, { color = true, width } = {}) {
  const paint = (codes, text) => (color ? `\x1b[${codes}m${text}\x1b[0m` : text)
  const fit = (line) =>
    width && Array.from(line).length > width
      ? `${Array.from(line)
          .slice(0, Math.max(1, width - 1))
          .join("")}…`
      : line
  const lines = [
    paint("1", fit(data.header[0])),
    paint("2", fit(data.header[1] ?? "")),
  ]
  for (const block of data.blocks) {
    const [label, codes] = LABELS[block.kind] ?? [block.kind, "1"]
    lines.push("", paint(codes, `▍${label}`))
    for (const line of block.text.split("\n")) {
      lines.push(block.kind === "reasoning" ? paint("2", fit(line)) : fit(line))
    }
  }
  if (data.more) lines.push("", paint("2", "…"))
  return lines.join("\n")
}
