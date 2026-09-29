import { ExportError, object, UnsupportedFormat } from "../model.js"
import { compareStrings, terminalText, trim } from "../text.js"
import { openReadDatabase } from "./sqlite.js"
import { t3Json, t3Text, t3Timestamp } from "./t3code-data.js"
import { t3Tools } from "./t3code-tools.js"

// Based on pingdotgg/t3code's 005_Projections migration and subsequent
// attachment/plan migrations. Read projections, never replay streaming events:
// projections already resolve message updates, plan updates, and reverts.
const REQUIRED = {
  projection_projects: ["project_id", "workspace_root", "deleted_at"],
  projection_threads: [
    "thread_id",
    "project_id",
    "title",
    "worktree_path",
    "updated_at",
    "deleted_at",
  ],
  projection_thread_messages: [
    "message_id",
    "thread_id",
    "role",
    "text",
    "created_at",
    "updated_at",
  ],
}
const OPTIONAL = {
  projection_thread_proposed_plans: [
    "plan_id",
    "thread_id",
    "plan_markdown",
    "created_at",
    "updated_at",
  ],
  projection_thread_activities: [
    "activity_id",
    "thread_id",
    "turn_id",
    "kind",
    "summary",
    "payload_json",
    "created_at",
  ],
}

export function t3Columns(db, table) {
  return new Set(db.all(`PRAGMA table_info("${table}")`).map((row) => row.name))
}

export async function openT3Code(path) {
  const db = await openReadDatabase(path, "T3 Code")
  try {
    for (const [table, required] of Object.entries(REQUIRED)) {
      const columns = t3Columns(db, table)
      const missing = required.filter((column) => !columns.has(column))
      if (missing.length) {
        throw new ExportError(
          `Unsupported T3 Code schema: ${table} is missing ${missing.join(", ")}`,
        )
      }
    }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function t3OptionalTable(db, table) {
  const columns = t3Columns(db, table)
  if (!columns.size) return false
  const missing = OPTIONAL[table].filter((column) => !columns.has(column))
  if (missing.length) {
    throw new UnsupportedFormat(
      `Unsupported T3 Code schema: ${table} is missing ${missing.join(", ")}; refusing a partial export`,
    )
  }
  return true
}

const THREADS = `SELECT t.thread_id, t.title, t.updated_at,
  coalesce(nullif(t.worktree_path, ''), p.workspace_root) AS directory
  FROM projection_threads t JOIN projection_projects p ON p.project_id=t.project_id
  WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL`

function metadata(row) {
  return {
    provider: "t3code",
    id: t3Text(row.thread_id, "thread ID"),
    title: t3Text(row.title, "title"),
    directory: t3Text(row.directory, "directory"),
    updatedAt: t3Timestamp(row.updated_at),
  }
}

export function listT3Code(db) {
  return db
    .all(THREADS + " ORDER BY t.updated_at DESC, t.thread_id DESC")
    .map(metadata)
}

export function readT3Code(db, id, reasoning = true, tools = false) {
  db.transaction("BEGIN")
  try {
    const row = db.get(THREADS + " AND t.thread_id=?", [id])
    if (!row)
      throw new ExportError(
        `T3 Code chat no longer exists or was deleted: ${id}`,
      )
    const chat = { ...metadata(row), records: [] }
    const columns = t3Columns(db, "projection_thread_messages")
    const attachments = columns.has("attachments_json")
      ? "attachments_json"
      : "NULL AS attachments_json"
    const records = []
    const add = (record, created, updated) => {
      const at = t3Timestamp(created)
      chat.updatedAt = Math.max(chat.updatedAt, t3Timestamp(updated))
      if (trim(record.text)) records.push({ ...record, at })
    }
    for (const message of db.all(
      `SELECT message_id, role, text, created_at, updated_at, ${attachments}
       FROM projection_thread_messages WHERE thread_id=? ORDER BY created_at, message_id`,
      [id],
    )) {
      const messageId = t3Text(message.message_id, "message ID")
      if (
        !["user", "assistant", "reasoning", "system"].includes(message.role)
      ) {
        throw new UnsupportedFormat(
          `Unsupported T3 Code message role in ${messageId}; refusing a partial export`,
        )
      }
      // System messages are app notices, not main conversation text.
      if (
        message.role === "system" ||
        (message.role === "reasoning" && !reasoning)
      )
        continue
      add(
        {
          kind: message.role,
          text: t3Text(message.text, "message text"),
          messageId,
          key: messageId,
        },
        message.created_at,
        message.updated_at,
      )
      if (message.attachments_json !== null) {
        const files = t3Json(message.attachments_json, "attachments")
        if (!Array.isArray(files))
          throw new ExportError(
            "Invalid T3 Code attachments; refusing a partial export",
          )
        for (const [index, value] of files.entries()) {
          const file = object(value)
          if (!file) throw new ExportError("Invalid T3 Code attachment")
          const name = terminalText(t3Text(file.name, "attachment name"))
          const mime = terminalText(
            t3Text(file.mimeType, "attachment MIME type"),
          )
          add(
            {
              kind: message.role,
              text: `[Attachment: ${name} (${mime})]`,
              messageId,
              key: `${messageId}:attachment:${index}`,
            },
            message.created_at,
            message.updated_at,
          )
        }
      }
    }
    if (t3OptionalTable(db, "projection_thread_proposed_plans")) {
      for (const plan of db.all(
        "SELECT plan_id, plan_markdown, created_at, updated_at FROM projection_thread_proposed_plans WHERE thread_id=? ORDER BY created_at, plan_id",
        [id],
      )) {
        add(
          {
            kind: "assistant",
            text: t3Text(plan.plan_markdown, "plan text"),
            key: `plan:${t3Text(plan.plan_id, "plan ID")}`,
          },
          plan.created_at,
          plan.updated_at,
        )
      }
    }
    if (tools && t3OptionalTable(db, "projection_thread_activities")) {
      const sequence = t3Columns(db, "projection_thread_activities").has(
        "sequence",
      )
        ? "sequence,"
        : ""
      records.push(
        ...t3Tools(
          db.all(
            `SELECT activity_id, turn_id, kind, summary, payload_json, created_at
         FROM projection_thread_activities WHERE thread_id=? AND kind IN ('tool.started', 'tool.updated', 'tool.completed')
         ORDER BY ${sequence} created_at, activity_id`,
            [id],
          ),
        ),
      )
    }
    // Stable sort keeps attachments with their message. Tie-break message and
    // plan IDs explicitly; lifecycle tools retain their first occurrence.
    records.sort(
      (a, b) =>
        a.at - b.at ||
        compareStrings(a.messageId ?? a.key, b.messageId ?? b.key),
    )
    chat.records = records.map(({ at, ...record }) => record)
    return chat
  } finally {
    db.transaction("ROLLBACK")
  }
}
