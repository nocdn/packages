import { resolve, sep } from "node:path"

import { ExportError, UnsupportedFormat } from "./model.js"
import { loadCodex, refreshCodex } from "./providers/codex.js"
import {
  listOpenCode,
  openOpenCode,
  readOpenCode,
} from "./providers/opencode.js"
import { recordText, trim, visibleRecords } from "./text.js"

export const PROVIDERS = ["codex", "opencode"]

// `options.directories` (from --here/--cwd) keeps chats whose working
// directory is one of those paths or inside one of them.
export function inDirectories(directory, directories) {
  if (!directories?.length) return true
  if (!directory) return false
  const path = resolve(directory)
  return directories.some(
    (root) =>
      path === root || path.startsWith(root.endsWith(sep) ? root : root + sep),
  )
}

// Sessions in an unsupported format are skipped (and counted through
// `onSkip`) so one of them cannot hide every other chat from the picker.
export async function* conversations(provider, options, onSkip = () => {}) {
  if (provider === "codex") {
    for (const chat of await loadCodex(options.codexHome, options)) {
      if (inDirectories(chat.directory, options.directories)) yield chat
    }
    return
  }
  const db = await openOpenCode(options.openCodeDb)
  try {
    for (const session of listOpenCode(db)) {
      if (!inDirectories(session.directory, options.directories)) continue
      let chat
      try {
        chat = readOpenCode(db, session.id, options.reasoning, options.tools)
      } catch (error) {
        if (!(error instanceof UnsupportedFormat)) throw error
        onSkip(session)
        continue
      }
      if (chat.records.length) yield chat
    }
  } finally {
    db.close()
  }
}

export function countVisible(chat, view) {
  return visibleRecords(chat, view).filter((record) =>
    trim(recordText(chat, record)),
  ).length
}

// The most recently updated chat with visible text, or null.
export async function latestConversation(provider, options, onSkip) {
  for await (const chat of conversations(provider, options, onSkip)) {
    if (countVisible(chat, options)) {
      return { provider, id: chat.id, updatedAt: chat.updatedAt }
    }
  }
  return null
}

export async function exportConversation(provider, id, options, selected) {
  if (provider === "codex") {
    return refreshCodex(options.codexHome, id, selected?.guard ?? [], options)
  }
  const db = await openOpenCode(options.openCodeDb)
  try {
    return readOpenCode(db, id, options.reasoning, options.tools)
  } finally {
    db.close()
  }
}

export async function listConversations(provider, options) {
  if (provider === "codex") {
    return (await loadCodex(options.codexHome))
      .filter((chat) => inDirectories(chat.directory, options.directories))
      .map((chat) => {
        const metadata = { ...chat }
        delete metadata.records
        return metadata
      })
  }
  const db = await openOpenCode(options.openCodeDb)
  try {
    return listOpenCode(db).filter((session) =>
      inDirectories(session.directory, options.directories),
    )
  } finally {
    db.close()
  }
}

export function requireProvider(value) {
  if (!PROVIDERS.includes(value)) {
    throw new ExportError("Provider must be codex or opencode")
  }
  return value
}
