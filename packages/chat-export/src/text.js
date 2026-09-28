import { ExportError } from "./model.js"

const SPACE =
  "[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]"
const SPACE_RUN = new RegExp(`${SPACE}+`, "gu")
const OUTER_SPACE = new RegExp(`^${SPACE}+|${SPACE}+$`, "gu")
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/gu

export const RECORD_SEPARATOR = "  ␞  "
export const HIDDEN_PADDING = " ".repeat(1024)

export const trim = (value) => value.replace(OUTER_SPACE, "")
export const compact = (value) => trim(value).replace(SPACE_RUN, " ")
export const oneLine = (value) => value.replace(CONTROLS, " ")
export const terminalText = (value) => compact(oneLine(value))

// fzf treats a leading apostrophe as an exact-match operator. Encode literal
// apostrophes (and the private-use characters used by the encoding) so exact
// phrase searches can include punctuation without being reinterpreted.
const EXACT_CODES = {
  "'": "",
  "": "",
  "": "",
  "": "",
}

export const encodeExact = (text) =>
  text.replace(/['-]/gu, (character) => EXACT_CODES[character])

export function validUnicode(value) {
  if (/\p{Surrogate}/u.test(value)) {
    throw new ExportError(
      "Chat contains invalid Unicode; refusing a lossy export",
    )
  }
  return value
}

export function compareStrings(a, b) {
  if (a === b) return 0
  const left = Array.from(a)
  const right = Array.from(b)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0) - right[i].codePointAt(0)
    if (difference) return difference
  }
  return left.length - right.length
}

export function dateLabel(timestamp) {
  const value = new Date(timestamp)
  if (!Number.isFinite(value.getTime())) return "(unknown time)"
  const pad = (n) => String(n).padStart(2, "0")
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`
}

// A view selects which records appear in search, previews, and exports:
// `reasoning` (default true) keeps reasoning; `userOnly` keeps only the
// user's own messages.
export function visibleRecords(chat, view = {}) {
  const reasoning = view.reasoning ?? true
  return chat.records.filter((record) =>
    view.userOnly
      ? record.kind === "user"
      : reasoning || record.kind !== "reasoning",
  )
}

export function recordText(chat, record) {
  return chat.provider === "codex"
    ? trim(record.text)
    : record.text.replace(/\r\n/gu, "\n").replace(/^[\r\n]+|[\r\n]+$/gu, "")
}

export function transcript(chat, view = {}) {
  const chunks = []
  let previous
  for (const record of visibleRecords(chat, view)) {
    const text = recordText(chat, record)
    if (!trim(text)) continue
    if (previous) {
      if (previous.kind === "reasoning" && record.kind === "reasoning") {
        chunks.push("\n")
      } else if (previous.kind !== "user" && record.kind !== "user") {
        chunks.push("\n\n")
      } else if (
        chat.provider === "opencode" &&
        previous.messageId === record.messageId
      ) {
        chunks.push("\n\n")
      } else {
        chunks.push("\n\n\n\n")
      }
    }
    chunks.push(text)
    previous = record
  }
  return validUnicode(chunks.join(""))
}

export function indexEntry(chat, view = {}) {
  const records = visibleRecords(chat, view)
  const previewRecord =
    chat.provider === "codex"
      ? records[0]
      : records.find((record) => record.kind === "user")
  const preview = previewRecord
    ? Array.from(compact(previewRecord.text)).slice(0, 100).join("")
    : ""
  const display =
    chat.provider === "codex"
      ? `${dateLabel(chat.updatedAt)}  |  ${chat.directory || "(unknown cwd)"}  |  ${preview || "(no visible text)"}`
      : `${dateLabel(chat.updatedAt)}  |  ${chat.title}  |  ${chat.directory}${preview ? `  |  ${preview}` : ""}`
  return {
    provider: chat.provider,
    id: chat.id,
    display: validUnicode(oneLine(display)),
    searchable: validUnicode(
      oneLine(
        records.map((record) => compact(record.text)).join(RECORD_SEPARATOR),
      ),
    ),
    guard:
      chat.provider === "codex"
        ? chat.records.map((record) => compact(record.text))
        : [],
  }
}

export function quotedPhrase(query) {
  return query.length >= 2 && query.startsWith('"') && query.endsWith('"')
    ? query.slice(1, -1)
    : undefined
}

export function fzfQuery(query) {
  const phrase = quotedPhrase(query)
  if (phrase !== undefined) {
    if (!phrase) return ""
    return (
      "'" +
      encodeExact(phrase).replace(/ /gu, "\\ ") +
      (phrase.endsWith("$") ? "$" : "")
    )
  }
  return query.startsWith('"') ? encodeExact(query.slice(1)) : query
}
