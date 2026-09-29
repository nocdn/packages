import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"

import { writable } from "./fixtures.js"

// The actual upstream migrations, reduced to export-relevant columns.
export async function t3Database(path, { legacy = false, wal = false } = {}) {
  await mkdir(dirname(path), { recursive: true })
  const db = await writable(path)
  db.exec(`
    CREATE TABLE projection_projects(project_id TEXT PRIMARY KEY, title TEXT, workspace_root TEXT NOT NULL, deleted_at TEXT);
    CREATE TABLE projection_threads(thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, worktree_path TEXT, updated_at TEXT NOT NULL, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE projection_thread_messages(message_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn_id TEXT, role TEXT NOT NULL, text TEXT NOT NULL, is_streaming INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX message_order ON projection_thread_messages(thread_id, created_at, message_id);
    CREATE TABLE projection_thread_activities(activity_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn_id TEXT, tone TEXT, kind TEXT NOT NULL, summary TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
  `)
  if (!legacy)
    db.exec(`
    ALTER TABLE projection_thread_messages ADD COLUMN attachments_json TEXT;
    ALTER TABLE projection_thread_activities ADD COLUMN sequence INTEGER;
    CREATE TABLE projection_thread_proposed_plans(plan_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn_id TEXT, plan_markdown TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `)
  if (wal) {
    db.exec("PRAGMA journal_mode=WAL")
    db.exec("PRAGMA wal_autocheckpoint=0")
  }
  db.run(
    "INSERT INTO projection_projects VALUES('project', 'Project', '/test/project', NULL)",
  )
  let sequence = 0
  return Object.assign(db, {
    thread(
      id = "main",
      {
        title = "T3 chat",
        worktree = null,
        updated = stamp(10),
        deleted = null,
        archived = null,
      } = {},
    ) {
      db.run(
        "INSERT INTO projection_threads VALUES(?, 'project', ?, ?, ?, ?, ?)",
        [id, title, worktree, updated, deleted, archived],
      )
    },
    message(
      id,
      role,
      text,
      {
        thread = "main",
        created = stamp(1),
        updated = created,
        attachments = null,
        streaming = false,
      } = {},
    ) {
      db.run(
        `INSERT INTO projection_thread_messages(message_id, thread_id, turn_id, role, text, is_streaming, created_at, updated_at${legacy ? "" : ", attachments_json"}) VALUES(?, ?, 'turn-1', ?, ?, ?, ?, ?${legacy ? "" : ", ?"})`,
        [
          id,
          thread,
          role,
          text,
          +streaming,
          created,
          updated,
          ...(legacy
            ? []
            : [attachments === null ? null : JSON.stringify(attachments)]),
        ],
      )
    },
    plan(id, text, created = stamp(5)) {
      db.run(
        "INSERT INTO projection_thread_proposed_plans VALUES(?, 'main', 'turn-1', ?, ?, ?)",
        [id, text, created, created],
      )
    },
    activity(
      id,
      kind,
      payload,
      {
        thread = "main",
        turn = "turn-1",
        created = stamp(3),
        summary = "Tool",
      } = {},
    ) {
      db.run(
        `INSERT INTO projection_thread_activities VALUES(?, ?, ?, 'tool', ?, ?, ?, ?${legacy ? "" : ", ?"})`,
        [
          id,
          thread,
          turn,
          kind,
          summary,
          JSON.stringify(payload),
          created,
          ...(legacy ? [] : [++sequence]),
        ],
      )
    },
  })
}

export function stamp(second) {
  return new Date(Date.UTC(2026, 8, 1, 10, 0, second)).toISOString()
}
