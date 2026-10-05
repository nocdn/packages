import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { runCli } from "../src/cli.js"
import { UnsupportedFormat } from "../src/model.js"
import { ChatMatcher } from "../src/pickers/matcher.js"
import { nativeArgs } from "../src/pickers/native.js"
import {
  conversations,
  exportConversation,
  listConversations,
} from "../src/provider.js"
import { listT3Code, openT3Code, readT3Code } from "../src/providers/t3code.js"
import { previewData, renderExport } from "../src/render.js"
import { indexEntry, transcript } from "../src/text.js"
import { indexChats } from "../src/worker-client.js"
import { bothFixtures, temporary, writable } from "./fixtures.js"
import { stamp, t3Database } from "./t3code-fixtures.js"

const CLI = fileURLToPath(new URL("../bin/cli.js", import.meta.url))

async function invoke(args, cwd) {
  let stdout = "",
    stderr = ""
  const exitCode = await runCli(args, {
    cwd,
    stdin: { isTTY: false },
    stdout: {
      write(chunk, callback) {
        stdout += chunk
        callback?.()
      },
    },
    stderr: {
      write(chunk) {
        stderr += chunk
      },
    },
  })
  return { exitCode, stdout, stderr }
}

const digest = (value) => createHash("sha256").update(value).digest("hex")

async function fixture(root, options = {}) {
  const path = join(root, "t3/userdata/state.sqlite")
  const db = await t3Database(path, options)
  db.thread()
  db.message("u1", "user", "T3 question 🦉", {
    attachments: [
      { type: "image", name: "screenshot.png", mimeType: "image/png" },
    ],
  })
  db.message("r1", "reasoning", "Thinking through it", { created: stamp(2) })
  db.message("a1", "assistant", "T3 answer\n```js\ncode()\n```", {
    created: stamp(4),
  })
  if (!options.legacy) db.plan("plan-1", "# Proposed plan\n\n1. Implement it.")
  db.message("s1", "system", "INTERNAL NOTICE", { created: stamp(6) })
  return { db, path, options: { t3CodeDb: path, reasoning: true } }
}

test("T3 reads ordered projected messages, reasoning, attachments and saved plans", () =>
  temporary(async (root) => {
    const { db: writer, path } = await fixture(root)
    writer.close()
    const before = digest(await readFile(path))
    const db = await openT3Code(path)
    try {
      const chat = readT3Code(db, "main")
      assert.deepEqual(
        chat.records.map((r) => [r.kind, r.text]),
        [
          ["user", "T3 question 🦉"],
          ["user", "[Attachment: screenshot.png (image/png)]"],
          ["reasoning", "Thinking through it"],
          ["assistant", "T3 answer\n```js\ncode()\n```"],
          ["assistant", "# Proposed plan\n\n1. Implement it."],
        ],
      )
      assert.equal(chat.provider, "t3code")
      assert.equal(chat.directory, "/test/project")
      assert.equal(chat.updatedAt, Date.parse(stamp(10)))
      const markdown = renderExport(chat, "markdown")
      assert.match(markdown, /Source:\*\* T3 Code/)
      assert.equal(markdown.match(/## User/g).length, 1)
      assert.match(markdown, /<summary>Reasoning<\/summary>/)
      assert.match(markdown, /# Proposed plan/)
      assert.deepEqual(
        JSON.parse(renderExport(chat, "json")).records.map((r) => r.role),
        ["user", "user", "reasoning", "assistant", "assistant"],
      )
      assert.equal(renderExport(chat, "text"), transcript(chat))
      assert.equal(previewData(chat).header[1].includes("T3 Code"), true)
      assert.deepEqual(
        JSON.parse(renderExport(chat, "json", { userOnly: true })).records.map(
          (r) => r.role,
        ),
        ["user", "user"],
      )
      assert.ok(
        !readT3Code(db, "main", false).records.some(
          (r) => r.kind === "reasoning",
        ),
      )
      assert.ok(
        !renderExport(chat, "text", { reasoning: false }).includes("Thinking"),
      )
    } finally {
      db.close()
    }
    assert.equal(digest(await readFile(path)), before)
  }))

test("T3 retains repeated text, orders tied IDs and exports long streaming projections once", () =>
  temporary(async (root) => {
    const path = join(root, "state.sqlite")
    const writer = await t3Database(path)
    writer.thread()
    writer.message("u2", "user", "Repeated")
    writer.message("u1", "user", "Repeated")
    const body = "🦉".repeat(100000) + " END OF LONG CHAT"
    writer.message("a", "assistant", body, {
      created: stamp(2),
      streaming: true,
    })
    writer.close()
    const db = await openT3Code(path)
    try {
      const chat = readT3Code(db, "main")
      assert.deepEqual(
        chat.records.map((r) => r.messageId),
        ["u1", "u2", "a"],
      )
      assert.equal(chat.records[2].text, body)
      assert.equal(transcript(chat).split("END OF LONG CHAT").length, 2)
      assert.ok(indexEntry(chat).searchable.endsWith("END OF LONG CHAT"))
      assert.ok(previewData(chat).blocks.at(-1).text.endsWith("…"))
    } finally {
      db.close()
    }
  }))

test("T3 includes archived and standalone worktree chats, excludes deleted threads and projects", () =>
  temporary(async (root) => {
    const path = join(root, "state.sqlite")
    const writer = await t3Database(path)
    writer.thread("archived", { archived: stamp(1), updated: stamp(20) })
    writer.thread("worktree", {
      worktree: "/test/worktrees/feature",
      updated: stamp(30),
    })
    writer.thread("deleted", { deleted: stamp(40), updated: stamp(40) })
    writer.message("w", "user", "Worktree", { thread: "worktree" })
    writer.close()
    assert.deepEqual(
      (await listConversations("t3code", { t3CodeDb: path })).map((r) => r.id),
      ["worktree", "archived"],
    )
    assert.deepEqual(
      (
        await listConversations("t3code", {
          t3CodeDb: path,
          directories: ["/test/worktrees"],
        })
      ).map((r) => r.id),
      ["worktree"],
    )
    const db = await openT3Code(path)
    try {
      assert.equal(listT3Code(db)[1].directory, "/test/project")
      assert.throws(() => readT3Code(db, "deleted"), /deleted/)
      assert.throws(() => readT3Code(db, "absent"), /no longer exists/)
    } finally {
      db.close()
    }
    const update = await writable(path)
    update.run("UPDATE projection_projects SET deleted_at=?", [stamp(50)])
    update.close()
    assert.deepEqual(await listConversations("t3code", { t3CodeDb: path }), [])
  }))

test("T3 supports initial migrations without attachments, plans or activity sequence", () =>
  temporary(async (root) => {
    const { db: writer, path } = await fixture(root, { legacy: true })
    writer.activity("t", "tool.completed", {
      toolCallId: "c",
      itemType: "command_execution",
      data: { item: { command: "pwd", aggregatedOutput: "/test" } },
    })
    writer.close()
    const db = await openT3Code(path)
    try {
      const chat = readT3Code(db, "main", true, true)
      assert.deepEqual(
        chat.records.map((r) => r.kind),
        ["user", "reasoning", "tool", "assistant"],
      )
      assert.equal(chat.records[2].tool.output, "/test")
    } finally {
      db.close()
    }
  }))

test("T3 --tools merges lifecycle updates per turn/call and keeps full Codex and Claude results", () =>
  temporary(async (root) => {
    const { db: writer, path } = await fixture(root)
    writer.activity("start", "tool.started", {
      toolCallId: "call",
      itemType: "command_execution",
      status: "inProgress",
      data: { item: { command: "pwd" } },
    })
    writer.activity(
      "update",
      "tool.updated",
      {
        toolCallId: "call",
        data: { item: { command: "pwd", aggregatedOutput: "PARTIAL" } },
      },
      { created: stamp(4) },
    )
    const output = "line\n".repeat(5000) + "END"
    writer.activity(
      "done",
      "tool.completed",
      {
        toolCallId: "call",
        status: "completed",
        data: {
          item: { command: "pwd", aggregatedOutput: output, exitCode: 0 },
        },
      },
      { created: stamp(6) },
    )
    writer.activity(
      "second",
      "tool.completed",
      {
        toolCallId: "call",
        itemType: "command_execution",
        status: "failed",
        data: {
          item: {
            command: "pwd",
            aggregatedOutput: "Failed output",
            exitCode: 1,
          },
        },
      },
      { turn: "turn-2", created: stamp(7) },
    )
    writer.activity(
      "claude",
      "tool.completed",
      {
        toolCallId: "claude",
        itemType: "dynamic_tool_call",
        status: "completed",
        data: {
          toolName: "Read",
          input: { file_path: "/test/file" },
          result: {
            type: "tool_result",
            content: "File text",
            is_error: false,
          },
        },
      },
      { created: stamp(8) },
    )
    writer.activity("child", "tool.completed", {
      toolCallId: "child",
      agentId: "subagent",
      itemType: "command_execution",
      data: { input: { command: "CHILD" } },
    })
    writer.activity("notice", "runtime.warning", { text: "INTERNAL" })
    writer.close()
    const db = await openT3Code(path)
    try {
      assert.ok(!readT3Code(db, "main").records.some((r) => r.kind === "tool"))
      const chat = readT3Code(db, "main", true, true)
      const tools = chat.records.filter((r) => r.kind === "tool")
      assert.equal(tools.length, 3)
      assert.equal(tools[0].tool.input, "$ pwd")
      assert.equal(tools[0].tool.output, output)
      assert.equal(tools[0].tool.failed, false)
      assert.equal(tools[1].tool.failed, true)
      assert.equal(tools[2].tool.name, "Read")
      assert.deepEqual(JSON.parse(tools[2].tool.output), {
        type: "tool_result",
        content: "File text",
        is_error: false,
      })
      for (const format of ["text", "markdown", "json"]) {
        const rendered = renderExport(chat, format)
        assert.ok(rendered.includes("END"))
        assert.ok(!rendered.includes("PARTIAL"))
        assert.ok(!rendered.includes("CHILD"))
      }
    } finally {
      db.close()
    }
  }))

test("T3 retains edits, MCP results, ACP tools, unknown tool data and unfinished calls", () =>
  temporary(async (root) => {
    const { db: writer, path } = await fixture(root)
    const samples = [
      {
        itemType: "file_change",
        data: {
          item: { changes: [{ path: "a.js", diff: "---\n+++\n+code" }] },
        },
      },
      {
        itemType: "mcp_tool_call",
        data: {
          item: {
            server: "example",
            tool: "lookup",
            arguments: { id: 1 },
            result: { content: [{ type: "text", text: "MCP output" }] },
          },
        },
      },
      {
        itemType: "dynamic_tool_call",
        data: {
          toolCallId: "acp",
          rawInput: { command: "ls" },
          rawOutput: { stdout: "ACP output" },
        },
      },
      {
        itemType: "web_search",
        data: { item: { action: { queries: ["query"] } } },
      },
      { itemType: "future_tool", data: { unknown: "KEEP ME" } },
      {
        itemType: "command_execution",
        status: "inProgress",
        data: {
          item: { command: "long job", aggregatedOutput: "Current output" },
        },
      },
    ]
    samples.forEach((payload, index) =>
      writer.activity(
        `t${index}`,
        index === 5 ? "tool.started" : "tool.completed",
        payload,
        { created: stamp(3 + index) },
      ),
    )
    writer.close()
    const chat = await exportConversation("t3code", "main", {
      t3CodeDb: path,
      tools: true,
    })
    const text = transcript(chat)
    for (const value of [
      "+code",
      "MCP output",
      "ACP output",
      "query",
      "KEEP ME",
      "Current output",
      "inProgress",
    ])
      assert.ok(text.includes(value), value)
  }))

test("T3 CLI exports every format, lists metadata, applies content and project filters, writes files", () =>
  temporary(async (root) => {
    const { db: writer, path } = await fixture(root)
    writer.close()
    const base = ["--provider", "t3code", "--t3-db", path]
    for (const format of ["text", "markdown", "json"]) {
      const result = await invoke([
        ...base,
        "--session",
        "main",
        "--stdout",
        "--format",
        format,
      ])
      assert.equal(result.exitCode, 0, result.stderr)
      assert.ok(result.stdout.includes("T3 question"))
      assert.ok(result.stdout.includes("Proposed plan"))
      assert.ok(!result.stdout.includes("INTERNAL"))
    }
    let result = await invoke([
      ...base,
      "--last",
      "--stdout",
      "--user-only",
      "--format",
      "json",
    ])
    assert.deepEqual(
      JSON.parse(result.stdout).records.map((r) => r.role),
      ["user", "user"],
    )
    result = await invoke([...base, "--list", "--json", "--cwd", "/test"])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout)[0].id, "main")
    result = await invoke([...base, "--list", "--cwd", "/test/project-other"])
    assert.equal(result.stdout, "")
    result = await invoke([...base, "--last", "--stdout", "--no-reasoning"])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.ok(!result.stdout.includes("Thinking"))
    const file = join(root, "export.md")
    result = await invoke([
      ...base,
      "--session",
      "main",
      "--format",
      "markdown",
      "-o",
      file,
    ])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.match(await readFile(file, "utf8"), /Source:\*\* T3 Code/)
    const project = join(root, "project")
    await mkdir(join(project, ".git"), { recursive: true })
    const update = await writable(path)
    update.run("UPDATE projection_projects SET workspace_root=?", [project])
    update.close()
    result = await invoke([...base, "--last", "--here", "--stdout"], project)
    assert.equal(result.exitCode, 0, result.stderr)
  }))

test("--last compares all three stores and tolerates a missing T3 store", () =>
  temporary(async (root) => {
    const stores = await bothFixtures(root)
    const { db: writer, path } = await fixture(root)
    writer.run(
      "UPDATE projection_threads SET updated_at='2099-01-01T00:00:00Z'",
    )
    writer.close()
    const base = ["--codex-home", stores.codexHome, "--db", stores.openCodeDb]
    let result = await invoke([...base, "--t3-db", path, "--last", "--stdout"])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.ok(result.stdout.startsWith("T3 question"))
    result = await invoke([
      ...base,
      "--t3-db",
      stores.t3CodeDb,
      "--last",
      "--stdout",
    ])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.ok(
      result.stdout.startsWith("Codex question") ||
        result.stdout.startsWith("Other question"),
    )
  }))

test("T3 real executable honours T3CODE_HOME under Node and Bun", () =>
  temporary(async (root) => {
    const { db: writer, path } = await fixture(root)
    writer.close()
    const result = spawnSync(
      process.execPath,
      [CLI, "--provider", "t3code", "--last", "--stdout", "--format", "json"],
      {
        encoding: "utf8",
        env: { ...process.env, T3CODE_HOME: join(root, "t3") },
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).provider, "t3code")
    const explicit = spawnSync(
      process.execPath,
      [CLI, "--provider", "t3code", "--t3-db", path, "--list"],
      {
        encoding: "utf8",
        env: { ...process.env, T3CODE_HOME: join(root, "ABSENT") },
      },
    )
    assert.equal(explicit.status, 0, explicit.stderr)
    assert.match(explicit.stdout, /main\tT3 chat/)
  }))

test("T3 worker indexes complete text and previews for fuzzy and exact search", () =>
  temporary(async (root) => {
    const { db: writer, options } = await fixture(root)
    writer.close()
    const entries = []
    for await (const entry of indexChats({
      mode: "index",
      provider: "t3code",
      options: { ...options, preview: true },
    }))
      entries.push(entry)
    assert.equal(entries.length, 1)
    assert.ok(entries[0].preview.header[1].includes("T3 Code"))
    assert.equal(
      new ChatMatcher(entries, true).find("Thinking through it").length,
      1,
    )
    assert.equal(new ChatMatcher(entries, false).find("T3question").length, 1)
    assert.equal(
      new ChatMatcher(entries, false).find('"Thinking through it"').length,
      1,
    )
    assert.equal(
      new ChatMatcher(entries, false).find('"Thinking it through"').length,
      0,
    )
    assert.ok(
      nativeArgs("fzf", "t3code", false, "").includes(
        "--prompt=T3 Code conversation > ",
      ),
    )
    assert.ok(
      nativeArgs("fzf", "t3code", false, "").some((arg) =>
        arg.includes("fzf-query.js"),
      ),
    )
  }))

test("T3 refresh uses current projections after edits, reverts, new plans and deleted chats", () =>
  temporary(async (root) => {
    const { db: writer, options } = await fixture(root, { wal: true })
    const indexed = []
    for await (const chat of conversations("t3code", options))
      indexed.push(chat)
    writer.run("DELETE FROM projection_thread_messages WHERE role='assistant'")
    writer.run(
      "UPDATE projection_thread_proposed_plans SET plan_markdown='Revised plan'",
    )
    writer.message("a2", "assistant", "Current answer", { created: stamp(8) })
    const refreshed = await exportConversation(
      "t3code",
      "main",
      options,
      indexEntry(indexed[0]),
    )
    assert.ok(!transcript(refreshed).includes("code()"))
    assert.ok(transcript(refreshed).includes("Revised plan"))
    assert.ok(transcript(refreshed).includes("Current answer"))
    writer.run("UPDATE projection_threads SET deleted_at=?", [stamp(20)])
    await assert.rejects(
      exportConversation("t3code", "main", options),
      /deleted/,
    )
    writer.close()
  }))

test("T3 committed WAL data is visible and all CLI modes leave database bytes unchanged", () =>
  temporary(async (root) => {
    const { db: writer, path } = await fixture(root, { wal: true })
    writer.message("a2", "assistant", "Committed in WAL", { created: stamp(9) })
    const files = [path, path + "-wal", path + "-shm"]
    // Open a reader once before hashing so SQLite has attached its WAL index.
    const db = await openT3Code(path)
    assert.ok(transcript(readT3Code(db, "main")).includes("Committed in WAL"))
    db.close()
    const before = await Promise.all(
      files.map(async (f) => digest(await readFile(f))),
    )
    try {
      for (const args of [
        ["--list", "--json"],
        ["--last", "--stdout"],
        ["--session", "main", "--stdout", "--tools", "--format", "json"],
      ]) {
        const result = await invoke([
          "--provider",
          "t3code",
          "--t3-db",
          path,
          ...args,
        ])
        assert.equal(result.exitCode, 0, result.stderr)
      }
      assert.deepEqual(
        await Promise.all(files.map(async (f) => digest(await readFile(f)))),
        before,
      )
    } finally {
      writer.close()
    }
  }))

test("T3 ignores unknown message roles; malformed data fails explicitly", () =>
  temporary(async (root) => {
    const { db: writer, path } = await fixture(root)
    writer.thread("future", { updated: stamp(30) })
    writer.message("future-q", "user", "Future question", { thread: "future" })
    writer.message("future-msg", "future-role", "Unknown", { thread: "future" })
    writer.close()
    const base = ["--provider", "t3code", "--t3-db", path]
    let result = await invoke([...base, "--last", "--stdout"])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.equal(result.stdout, "Future question")
    assert.equal(result.stderr, "")
    const update = await writable(path)
    update.run(
      "UPDATE projection_thread_messages SET attachments_json='not json' WHERE message_id='u1'",
    )
    update.close()
    result = await invoke([...base, "--session", "main", "--stdout"])
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /Invalid T3 Code attachments/)
  }))

test("T3 rejects missing stores, incompatible schemas, timestamps, attachments and Unicode", () =>
  temporary(async (root) => {
    await assert.rejects(
      openT3Code(join(root, "absent")),
      /T3 Code database not found/,
    )
    const path = join(root, "incompatible.sqlite")
    const empty = await writable(path)
    empty.close()
    await assert.rejects(openT3Code(path), /Unsupported T3 Code schema/)
    const { db: writer, path: good } = await fixture(root)
    writer.run("UPDATE projection_threads SET updated_at='invalid'")
    const db = await openT3Code(good)
    try {
      assert.throws(() => listT3Code(db), /timestamp/)
      writer.run("UPDATE projection_threads SET updated_at=?", [stamp(10)])
      writer.run(
        "UPDATE projection_thread_messages SET attachments_json='{}' WHERE message_id='u1'",
      )
      assert.throws(() => readT3Code(db, "main"), /attachments/)
      writer.run(
        "UPDATE projection_thread_messages SET attachments_json=? WHERE message_id='u1'",
        [JSON.stringify([{ name: "bad\ud800.png", mimeType: "image/png" }])],
      )
      assert.throws(
        () => renderExport(readT3Code(db, "main"), "json"),
        /Invalid T3 Code attachments/,
      )
      writer.run("UPDATE projection_thread_messages SET attachments_json=NULL")
      writer.exec(
        "DROP TABLE projection_thread_proposed_plans; CREATE TABLE projection_thread_proposed_plans(plan_id TEXT)",
      )
      assert.throws(() => readT3Code(db, "main"), UnsupportedFormat)
    } finally {
      db.close()
      writer.close()
    }
  }))

test("T3 full completion beats shortened progress, including unsequenced timestamp ties", () =>
  temporary(async (root) => {
    const { db: writer, path } = await fixture(root)
    const completed = {
      toolCallId: "call",
      itemType: "mcp_tool_call",
      status: "completed",
      data: {
        toolName: "lookup",
        input: { id: 1 },
        result: { content: "Full result\n".repeat(2000) },
      },
    }
    writer.activity("a-completed", "tool.completed", completed)
    writer.activity("b-started", "tool.started", {
      ...completed,
      status: "inProgress",
      data: { toolName: "lookup", input: { id: 1 } },
    })
    writer.activity("c-updated", "tool.updated", {
      ...completed,
      status: "inProgress",
      data: { ...completed.data, result: { content: "Shortened" } },
    })
    writer.run("UPDATE projection_thread_activities SET sequence=NULL")
    writer.activity(
      "d-late",
      "tool.updated",
      {
        ...completed,
        status: "inProgress",
        data: { ...completed.data, result: { content: "Later progress" } },
      },
      { created: stamp(8) },
    )
    writer.close()
    const chat = await exportConversation("t3code", "main", {
      t3CodeDb: path,
      tools: true,
    })
    const tools = chat.records.filter((r) => r.kind === "tool")
    assert.equal(tools.length, 1)
    assert.equal(
      JSON.parse(tools[0].tool.output).content,
      completed.data.result.content,
    )
    assert.ok(!tools[0].tool.summary.includes("inProgress"))
  }))

test("T3 messages, plans and tools share a read snapshot during concurrent writes", () =>
  temporary(async (root) => {
    const { db: writer, path } = await fixture(root, { wal: true })
    writer.activity("tool", "tool.completed", {
      toolCallId: "call",
      itemType: "command_execution",
      data: { item: { command: "pwd", aggregatedOutput: "Old tool" } },
    })
    const db = await openT3Code(path)
    let changed = false
    const concurrent = {
      ...db,
      all(sql, args) {
        const rows = db.all(sql, args)
        if (!changed && sql.includes("FROM projection_thread_messages")) {
          changed = true
          writer.exec("BEGIN")
          writer.run(
            "UPDATE projection_thread_messages SET text='New message' WHERE message_id='a1'",
          )
          writer.run(
            "UPDATE projection_thread_proposed_plans SET plan_markdown='New plan'",
          )
          writer.run("UPDATE projection_thread_activities SET payload_json=?", [
            JSON.stringify({
              toolCallId: "call",
              itemType: "command_execution",
              data: { item: { command: "pwd", aggregatedOutput: "New tool" } },
            }),
          ])
          writer.exec("COMMIT")
        }
        return rows
      },
    }
    try {
      const first = readT3Code(concurrent, "main", true, true)
      assert.ok(transcript(first).includes("T3 answer"))
      assert.ok(transcript(first).includes("Proposed plan"))
      assert.ok(transcript(first).includes("Old tool"))
      assert.ok(!transcript(first).includes("New"))
      const next = readT3Code(db, "main", true, true)
      for (const text of ["New message", "New plan", "New tool"])
        assert.ok(transcript(next).includes(text))
    } finally {
      db.close()
      writer.close()
    }
  }))
