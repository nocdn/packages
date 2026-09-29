import { resolve, sep } from "node:path"

import { ExportError, UnsupportedFormat } from "./model.js"
import { loadCodex, refreshCodex } from "./providers/codex.js"
import {
  listOpenCode,
  openOpenCode,
  readOpenCode,
} from "./providers/opencode.js"
import { listT3Code, openT3Code, readT3Code } from "./providers/t3code.js"
import { recordText, trim, visibleRecords } from "./text.js"

export const PROVIDERS = ["codex", "opencode", "t3code"]

const DATABASE_PROVIDERS = {
  opencode: {
    open: openOpenCode,
    list: listOpenCode,
    read: readOpenCode,
    path: "openCodeDb",
  },
  t3code: {
    open: openT3Code,
    list: listT3Code,
    read: readT3Code,
    path: "t3CodeDb",
  },
}

function databaseProvider(provider) {
  requireProvider(provider)
  return DATABASE_PROVIDERS[provider]
}

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
  const store = databaseProvider(provider)
  const db = await store.open(options[store.path])
  try {
    for (const session of store.list(db)) {
      if (!inDirectories(session.directory, options.directories)) continue
      let chat
      try {
        chat = store.read(db, session.id, options.reasoning, options.tools)
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
  const store = databaseProvider(provider)
  const db = await store.open(options[store.path])
  try {
    return store.read(db, id, options.reasoning, options.tools)
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
  const store = databaseProvider(provider)
  const db = await store.open(options[store.path])
  try {
    return store
      .list(db)
      .filter((session) =>
        inDirectories(session.directory, options.directories),
      )
  } finally {
    db.close()
  }
}

export function requireProvider(value) {
  if (!PROVIDERS.includes(value)) {
    throw new ExportError("Provider must be codex, opencode, or t3code")
  }
  return value
}
