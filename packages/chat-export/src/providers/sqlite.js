import { realpath, stat } from "node:fs/promises"
import process from "node:process"

import { ExportError, MissingStore } from "../model.js"

function readQuery(sql) {
  if (
    sql.includes(";") ||
    /\bload_extension\s*\(/iu.test(sql) ||
    (!/^\s*SELECT\b/iu.test(sql) &&
      !/^PRAGMA table_info\("[a-z0-9_]+"\)$/u.test(sql))
  ) {
    throw new ExportError("Only read queries are allowed")
  }
}

// Opens a SQLite database strictly read-only, using bun:sqlite under Bun and
// node:sqlite under Node. Committed WAL data is visible; nothing is written.
export async function openReadDatabase(path) {
  if (!(await stat(path).catch(() => undefined))?.isFile()) {
    throw new MissingStore(`OpenCode database not found: ${path}`)
  }
  const file = await realpath(path)
  if (process.versions.bun) {
    const { Database } = await import("bun:sqlite")
    const db = new Database(file, {
      readonly: true,
      create: false,
      strict: true,
    })
    try {
      db.exec("PRAGMA query_only=ON")
      db.exec("PRAGMA busy_timeout=3000")
      db.exec("PRAGMA temp_store=MEMORY")
    } catch (error) {
      db.close()
      throw error
    }
    return {
      all(sql, args = []) {
        readQuery(sql)
        const statement = db.prepare(sql)
        try {
          return statement.all(...args)
        } finally {
          statement.finalize()
        }
      },
      get(sql, args = []) {
        readQuery(sql)
        const statement = db.prepare(sql)
        try {
          return statement.get(...args) ?? undefined
        } finally {
          statement.finalize()
        }
      },
      transaction(command) {
        if (command !== "BEGIN" && command !== "ROLLBACK") {
          throw new ExportError("Only read transactions are allowed")
        }
        if (command !== "ROLLBACK" || db.inTransaction) db.exec(command)
      },
      close() {
        db.close()
      },
    }
  }
  const { DatabaseSync, constants } = await import("node:sqlite")
  const db = new DatabaseSync(file, { readOnly: true, allowExtension: false })
  try {
    db.exec("PRAGMA query_only=ON")
    db.exec("PRAGMA busy_timeout=3000")
    db.exec("PRAGMA temp_store=MEMORY")
    if (typeof db.setAuthorizer === "function") {
      const allowed = new Set([
        constants.SQLITE_SELECT,
        constants.SQLITE_READ,
        constants.SQLITE_FUNCTION,
      ])
      db.setAuthorizer((action, arg1) =>
        allowed.has(action) ||
        (action === constants.SQLITE_PRAGMA && arg1 === "table_info") ||
        (action === constants.SQLITE_TRANSACTION &&
          (arg1 === "BEGIN" || arg1 === "ROLLBACK"))
          ? constants.SQLITE_OK
          : constants.SQLITE_DENY,
      )
    }
  } catch (error) {
    db.close()
    throw error
  }
  return {
    all(sql, args = []) {
      readQuery(sql)
      return db.prepare(sql).all(...args)
    },
    get(sql, args = []) {
      readQuery(sql)
      return db.prepare(sql).get(...args)
    },
    transaction(command) {
      if (command !== "BEGIN" && command !== "ROLLBACK") {
        throw new ExportError("Only read transactions are allowed")
      }
      if (command !== "ROLLBACK" || db.isTransaction !== false) db.exec(command)
    },
    close() {
      db.close()
    },
  }
}
