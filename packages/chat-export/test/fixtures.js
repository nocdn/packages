import process from "node:process"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"

export async function temporary(run) {
  const root = await mkdtemp(join(tmpdir(), "export-chat-test-"))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
export function meta(id = "main", stamp = "2026-09-01T10:00:00Z", extra = {}) {
  return {
    type: "session_meta",
    payload: { id, timestamp: stamp, cwd: "/test/project", ...extra },
  }
}
export function event(type, text, phase = "final_answer") {
  return {
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        type,
        ...(type === "Reasoning"
          ? { summary_text: [text] }
          : { content: [{ type: "text", text }], phase }),
      },
    },
  }
}
export function fallback(role, text) {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role,
      phase: "final_answer",
      content: [{ text }],
    },
  }
}
export async function rollout(path, rows, tail = "") {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    rows.map((row) => JSON.stringify(row) + "\n").join("") + tail,
  )
}
export async function writable(path) {
  let raw
  if (process.versions.bun) {
    const { Database } = await import("bun:sqlite")
    raw = new Database(path)
    return {
      exec: (sql) => raw.exec(sql),
      run(sql, args = []) {
        const stmt = raw.prepare(sql)
        try {
          return stmt.run(...args)
        } finally {
          stmt.finalize()
        }
      },
      get(sql, args = []) {
        const stmt = raw.prepare(sql)
        try {
          return stmt.get(...args)
        } finally {
          stmt.finalize()
        }
      },
      close: () => raw.close(),
    }
  }
  const { DatabaseSync } = await import("node:sqlite")
  raw = new DatabaseSync(path)
  return {
    exec: (sql) => raw.exec(sql),
    run: (sql, args = []) => raw.prepare(sql).run(...args),
    get: (sql, args = []) => raw.prepare(sql).get(...args),
    close: () => raw.close(),
  }
}
export async function database(path, wal = false) {
  await mkdir(dirname(path), { recursive: true })
  const db = await writable(path)
  db.exec(`
    CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, title TEXT NOT NULL, directory TEXT NOT NULL, time_updated INTEGER NOT NULL, revert TEXT, time_archived INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX message_order ON message(session_id,time_created,id);
    CREATE INDEX part_order ON part(message_id,id);
    CREATE TABLE session_message(id TEXT PRIMARY KEY, session_id TEXT, seq INTEGER, data TEXT);
  `)
  if (wal) {
    db.exec("PRAGMA journal_mode=WAL")
    db.exec("PRAGMA wal_autocheckpoint=0")
  }
  db.run(
    "INSERT INTO session VALUES('root',NULL,'Main chat','/test',200,NULL,NULL)",
  )
  db.run(
    "INSERT INTO session VALUES('child','root','Child chat','/test',300,NULL,NULL)",
  )
  db.run(
    "INSERT INTO session VALUES('fork',NULL,'Fork chat','/test',100,NULL,1)",
  )
  let clock = 10000
  return Object.assign(db, {
    message(id, created, role = "user", session = "root", extra = {}) {
      db.run("INSERT INTO message VALUES(?,?,?,?,?)", [
        id,
        session,
        created,
        10000 - created,
        JSON.stringify({ role, agent: "custom-primary", ...extra }),
      ])
    },
    part(id, message, text = "", type = "text", session = "root", extra = {}) {
      clock++
      db.run("INSERT INTO part VALUES(?,?,?,?,?,?)", [
        id,
        message,
        session,
        clock,
        clock,
        JSON.stringify({ type, text, ...extra }),
      ])
    },
  })
}
export async function bothFixtures(root) {
  const codexHome = join(root, "codex"),
    openCodeDb = join(root, "data/opencode/opencode.db")
  const phrase = "James' path\\file cost$"
  await rollout(join(codexHome, "sessions/main.jsonl"), [
    meta(),
    event("UserMessage", "Codex question 🦉"),
    event("AgentMessage", "Before " + phrase + " after"),
  ])
  await rollout(join(codexHome, "sessions/other.jsonl"), [
    meta("other"),
    event("UserMessage", "Other question"),
    event("AgentMessage", "Before James pathfile cost after"),
  ])
  await rollout(join(codexHome, "sessions/child.jsonl"), [
    meta("child", undefined, {
      thread_source: "subagent",
      parent_thread_id: "main",
    }),
    event("UserMessage", "CHILD OUTPUT"),
  ])
  const db = await database(openCodeDb)
  db.message("u", 1)
  db.message("a", 2, "assistant")
  db.message("c", 1, "assistant", "child")
  db.part("u1", "u", "OpenCode question 🦉")
  db.part("a1", "a", "OpenCode answer")
  db.part("c1", "c", "CHILD OUTPUT", "text", "child")
  db.close()
  return { codexHome, openCodeDb, reasoning: true, phrase }
}
// Adds OpenCode's newer `session_v2` / `session_message` layout to a fixture
// database, replacing the minimal `session_message` table.
export async function v2Database(path) {
  const db = await database(path)
  db.exec(`
    DROP TABLE session_message;
    CREATE TABLE session_v2(id TEXT PRIMARY KEY, parent_id TEXT, slug TEXT NOT NULL, directory TEXT NOT NULL, title TEXT, revert TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);
    CREATE TABLE session_message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL, seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);
  `)
  let seq = 0
  return Object.assign(db, {
    session2(
      id,
      {
        parent = null,
        title = null,
        slug = id,
        updated = 100,
        revert = null,
      } = {},
    ) {
      db.run("INSERT INTO session_v2 VALUES(?,?,?,?,?,?,?,?)", [
        id,
        parent,
        slug,
        "/test",
        title,
        revert,
        1,
        updated,
      ])
    },
    message2(id, created, type, data, session = "root") {
      seq++
      db.run("INSERT INTO session_message VALUES(?,?,?,?,?,?,?)", [
        id,
        session,
        type,
        seq,
        created,
        created,
        JSON.stringify(data),
      ])
    },
  })
}
