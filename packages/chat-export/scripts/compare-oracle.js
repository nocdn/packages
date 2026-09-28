// Optional local validation. Oracle files contain hashes/counts, no chat text.
import { readFile, stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import process from "node:process"
import { performance } from "node:perf_hooks"
import { loadCodex } from "../src/providers/codex.js"
import {
  listOpenCode,
  openOpenCode,
  readOpenCode,
} from "../src/providers/opencode.js"
import { transcript } from "../src/text.js"

const [provider, store, oracleFile] = process.argv.slice(2)
const oracle = JSON.parse(await readFile(oracleFile, "utf8"))
const started = performance.now()
let matched = 0,
  changed = 0,
  added = 0,
  textBytes = 0
const seen = new Set()
function compare(id, chat, before, after) {
  seen.add(id)
  const reference = oracle[id]
  if (!reference) {
    added++
    return
  }
  if (
    !reference.stable ||
    JSON.stringify(before) !== JSON.stringify(after) ||
    JSON.stringify(reference.fingerprint) !== JSON.stringify(after)
  ) {
    changed++
    return
  }
  const body = transcript(chat)
  const hash = createHash("sha256").update(body).digest("hex")
  if (hash !== reference.hash || chat.records.length !== reference.parts)
    throw new Error(`Export parity mismatch for ${id}`)
  matched++
  textBytes += Buffer.byteLength(body)
}
async function files(paths) {
  const values = []
  for (const path of paths) {
    try {
      const s = await stat(path, { bigint: true })
      values.push([path, String(s.size), String(s.mtimeNs)])
    } catch {
      values.push([path, "missing"])
    }
  }
  return values.sort((a, b) => a[0].localeCompare(b[0], "en"))
}
if (provider === "codex") {
  const initial = new Map()
  for (const [id, value] of Object.entries(oracle))
    initial.set(id, await files(value.fingerprint.map((x) => x[0])))
  for (const chat of await loadCodex(store))
    compare(chat.id, chat, initial.get(chat.id), await files(chat.paths))
} else {
  const db = await openOpenCode(store)
  function fingerprint(id) {
    const session = db.get(
      "SELECT parent_id,time_updated,revert FROM session WHERE id=?",
      [id],
    )
    const message = db.get(
      "SELECT count(*) AS count,max(time_updated) AS updated FROM message WHERE session_id=?",
      [id],
    )
    const part = db.get(
      "SELECT count(*) AS count,max(time_updated) AS updated FROM part WHERE session_id=?",
      [id],
    )
    return [
      session
        ? [session.parent_id, session.time_updated, session.revert]
        : null,
      [message.count, message.updated],
      [part.count, part.updated],
    ]
  }
  try {
    for (const metadata of listOpenCode(db)) {
      const before = fingerprint(metadata.id)
      const chat = readOpenCode(db, metadata.id)
      compare(chat.id, chat, before, fingerprint(chat.id))
    }
  } finally {
    db.close()
  }
}
process.stdout.write(
  JSON.stringify({
    runtime: process.versions.bun ? "bun" : "node",
    provider,
    matched,
    changed,
    added,
    removed: Object.keys(oracle).filter((id) => !seen.has(id)).length,
    textBytes,
    seconds: Math.round((performance.now() - started) / 10) / 100,
  }) + "\n",
)
