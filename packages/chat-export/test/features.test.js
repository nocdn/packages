import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, stat, utimes } from "node:fs/promises"
import { join } from "node:path"
import process from "node:process"
import test from "node:test"
import { fileURLToPath, URL } from "node:url"

import { runCli } from "../src/cli.js"
import { nativeArgs, nativeRow } from "../src/pickers/native.js"
import { inDirectories } from "../src/provider.js"
import { loadCodex, parseCodex } from "../src/providers/codex.js"
import { openOpenCode, readOpenCode } from "../src/providers/opencode.js"
import {
  jsonTranscript,
  markdownTranscript,
  previewData,
  renderPreview,
} from "../src/render.js"
import { indexEntry, transcript } from "../src/text.js"
import { indexChats } from "../src/worker-client.js"
import {
  bothFixtures,
  database,
  event,
  fallback,
  meta,
  rollout,
  temporary,
  writable,
} from "./fixtures.js"

const CLI = fileURLToPath(new URL("../bin/cli.js", import.meta.url))
const PREVIEW = fileURLToPath(new URL("../src/fzf-preview.js", import.meta.url))

function completed(item) {
  return { type: "event_msg", payload: { type: "item_completed", item } }
}

async function invoke(args, { cwd } = {}) {
  let stdout = ""
  let stderr = ""
  const exitCode = await runCli(args, {
    stdin: { isTTY: false },
    ...(cwd ? { cwd } : {}),
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

function stores(options) {
  return ["--codex-home", options.codexHome, "--db", options.openCodeDb]
}

// Every file under a directory, with a content hash, so tests can prove the
// CLI never modifies a chat store.
async function fingerprint(root) {
  const result = {}
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else {
        const info = await stat(path)
        result[path] = [
          info.size,
          info.mtimeMs,
          createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        ]
      }
    }
  }
  await walk(root)
  return result
}

test("Codex --tools reads commands, edits, MCP calls, searches and images", () =>
  temporary(async (root) => {
    const path = join(root, "sessions/main.jsonl")
    const shell = (id, cmd, output, exit = 0) =>
      completed({
        type: "CommandExecution",
        id,
        command: ["/bin/zsh", "-lc", cmd],
        aggregated_output: output,
        exit_code: exit,
        status: exit ? "failed" : "completed",
      })
    await rollout(path, [
      meta(),
      event("UserMessage", "Run the tests"),
      shell("c1", "ls", "a.txt\n"),
      shell("c2", "ls", "a.txt\n"),
      shell("c3", "npm test", "1 failing", 1),
      completed({
        type: "FileChange",
        id: "f1",
        status: "completed",
        changes: {
          "/p/a.txt": { type: "update", unified_diff: "@@ -1 +1 @@\n-a\n+b\n" },
        },
      }),
      completed({
        type: "McpToolCall",
        id: "m1",
        server: "docs",
        tool: "search",
        arguments: { q: "x" },
        status: "completed",
        result: { content: [{ type: "text", text: "found" }], isError: false },
      }),
      completed({
        type: "Extension",
        id: "w1",
        kind: "web.search",
        query: "node test runner",
        results: [{ title: "Docs", url: "https://nodejs.org" }],
      }),
      completed({ type: "ImageView", id: "i1", path: "/p/shot.png" }),
      completed({ type: "SubAgentActivity", id: "s1", kind: "started" }),
      event("AgentMessage", "Done"),
    ])

    const plain = await parseCodex(path)
    assert.deepEqual(
      plain.records.map((record) => record.kind),
      ["user", "assistant"],
    )

    const chat = await parseCodex(path, { tools: true })
    const tools = chat.records.filter((record) => record.kind === "tool")
    // Two identical `ls` runs are separate tool calls and both are kept.
    assert.deepEqual(
      tools.map((record) => record.tool.name),
      [
        "shell",
        "shell",
        "shell",
        "edit",
        "docs.search",
        "web search",
        "view image",
      ],
    )
    assert.equal(tools[0].tool.input, "$ ls")
    assert.equal(tools[2].tool.failed, true)
    assert.match(
      tools[2].text,
      /^\[Tool: shell\] \(exit 1\) \(failed\)\n\$ npm test\nOutput:\n1 failing$/,
    )
    assert.match(tools[3].tool.input, /^update \/p\/a\.txt\n@@ -1 \+1 @@/)
    assert.equal(tools[4].tool.output, "found")
    assert.equal(tools[5].tool.output, "Docs - https://nodejs.org")
    assert.equal(tools[6].tool.summary, "/p/shot.png")

    // Tool keys survive fragment merging without collapsing repeated commands.
    const [merged] = await loadCodex(root, { tools: true })
    assert.equal(merged.records.filter((r) => r.kind === "tool").length, 7)
  }))

test("Codex --tools pairs legacy calls with outputs when events are absent", () =>
  temporary(async (root) => {
    const path = join(root, "sessions/old.jsonl")
    await rollout(path, [
      meta("old"),
      fallback("user", "Legacy question"),
      {
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: '{"cmd":"pwd"}',
          call_id: "call_1",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_1",
          output: [{ type: "input_text", text: "/work" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "apply_patch",
          input: "*** Begin Patch",
          call_id: "call_2",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call_2",
          output: "Success",
        },
      },
      fallback("assistant", "Legacy answer"),
    ])
    const chat = await parseCodex(path, { tools: true })
    assert.deepEqual(
      chat.records.map((record) => [
        record.kind,
        record.tool?.name ?? record.text,
      ]),
      [
        ["user", "Legacy question"],
        ["tool", "exec_command"],
        ["tool", "apply_patch"],
        ["assistant", "Legacy answer"],
      ],
    )
    assert.equal(chat.records[1].tool.input, '{\n  "cmd": "pwd"\n}')
    assert.equal(chat.records[1].tool.output, "/work")
    assert.equal(chat.records[2].tool.output, "Success")
    assert.deepEqual(
      (await parseCodex(path)).records.map((record) => record.kind),
      ["user", "assistant"],
    )
  }))

test("OpenCode --tools includes tool parts in order, including errors", () =>
  temporary(async (root) => {
    const path = join(root, "chat.db")
    const writer = await database(path)
    try {
      writer.message("u", 1)
      writer.message("a", 2, "assistant")
      writer.part("p1", "u", "Fix it")
      writer.part("p2", "a", "", "tool", "root", {
        tool: "bash",
        callID: "call_1",
        state: {
          status: "completed",
          input: { command: "npm test" },
          output: "ok",
          title: "npm test",
        },
      })
      writer.part("p3", "a", "", "tool", "root", {
        tool: "edit",
        callID: "call_2",
        state: {
          status: "error",
          input: { filePath: "/p/a.js" },
          error: "no match",
          title: "a.js",
        },
      })
      writer.part("p4", "a", "Fixed")
      const db = await openOpenCode(path)
      try {
        assert.deepEqual(
          readOpenCode(db, "root").records.map((r) => r.partId),
          ["p1", "p4"],
        )
        const records = readOpenCode(db, "root", true, true).records
        assert.deepEqual(
          records.map((r) => r.partId),
          ["p1", "p2", "p3", "p4"],
        )
        assert.equal(records[1].tool.input, "$ npm test")
        assert.equal(records[1].tool.output, "ok")
        assert.equal(records[2].tool.failed, true)
        assert.equal(records[2].tool.output, "no match")
        assert.match(records[2].tool.input, /"filePath": "\/p\/a\.js"/)
        assert.equal(
          transcript({ provider: "opencode", records }),
          'Fix it\n\n\n\n[Tool: bash]\n$ npm test\nOutput:\nok\n\n[Tool: edit] a.js (failed)\n{\n  "filePath": "/p/a.js"\n}\nOutput:\nno match\n\nFixed',
        )
      } finally {
        db.close()
      }
    } finally {
      writer.close()
    }
  }))

const sample = {
  provider: "opencode",
  id: "ses_1",
  title: "Fix the build",
  directory: "/work",
  updatedAt: 0,
  records: [
    { kind: "user", text: "First", messageId: "m1" },
    { kind: "user", text: "Same message", messageId: "m1" },
    { kind: "reasoning", text: "Think one", messageId: "m2" },
    { kind: "reasoning", text: "Think two", messageId: "m2" },
    {
      kind: "assistant",
      text: "Use ```js\ncode\n``` like this",
      messageId: "m2",
    },
    {
      kind: "tool",
      text: "[Tool: bash]\n$ ls",
      tool: {
        name: "bash",
        summary: "",
        input: "$ ls",
        output: "has ```` fences <b>",
        lang: "sh",
        failed: false,
      },
      messageId: "m2",
    },
    { kind: "user", text: "Next", messageId: "m3" },
  ],
}

test("Markdown output groups turns, folds reasoning and tools, and escapes fences", () => {
  const markdown = markdownTranscript(sample)
  assert.match(
    markdown,
    /^# Fix the build\n\n- \*\*Source:\*\* OpenCode\n- \*\*Session:\*\* `ses_1`\n- \*\*Directory:\*\* `\/work`\n/,
  )
  assert.equal(markdown.match(/^## User$/gm).length, 2)
  assert.equal(markdown.match(/^## Assistant$/gm).length, 1)
  assert.match(markdown, /## User\n\nFirst\n\nSame message\n\n## Assistant/)
  assert.match(
    markdown,
    /<details>\n<summary>Reasoning<\/summary>\n\nThink one\n\nThink two\n\n<\/details>/,
  )
  assert.match(markdown, /<summary>Tool: bash: \$ ls<\/summary>/)
  // The output contains a run of four backticks, so its fence uses five.
  assert.match(markdown, /`````text\nhas ```` fences <b>\n`````/)
  assert.ok(markdown.endsWith("## User\n\nNext\n"))

  const userOnly = markdownTranscript(sample, { userOnly: true })
  assert.doesNotMatch(userOnly, /Assistant|Reasoning|Tool/)
  assert.doesNotMatch(markdownTranscript(sample, { reasoning: false }), /Think/)
})

test("JSON output lists visible records with structured tool fields", () => {
  const value = JSON.parse(jsonTranscript(sample, { reasoning: false }))
  assert.equal(value.id, "ses_1")
  assert.equal(value.title, "Fix the build")
  assert.equal(value.updatedAt, "1970-01-01T00:00:00.000Z")
  assert.deepEqual(
    value.records.map((record) => record.role),
    ["user", "user", "assistant", "tool", "user"],
  )
  assert.equal(value.records[3].tool.input, "$ ls")
  assert.deepEqual(
    JSON.parse(jsonTranscript(sample, { userOnly: true })).records.map(
      (record) => record.text,
    ),
    ["First", "Same message", "Next"],
  )
})

test("--user-only limits text transcripts, search, and previews", () => {
  assert.equal(
    transcript(sample, { userOnly: true }),
    "First\n\nSame message\n\n\n\nNext",
  )
  assert.doesNotMatch(
    indexEntry(sample, { userOnly: true }).searchable,
    /Think|ls/,
  )
})

test("previews are bounded and strip terminal control sequences", () => {
  const chat = {
    ...sample,
    records: [
      { kind: "user", text: "Hi \u001b]52;c;evil\u0007 there\r\nline two" },
      { kind: "assistant", text: "x".repeat(5000) },
      { kind: "assistant", text: "never shown" },
    ],
  }
  const data = previewData(chat)
  assert.equal(data.header[0], "Fix the build")
  assert.match(
    data.header[1],
    /^OpenCode {2}· {2}1970-01-01 \d\d:\d\d {2}· {2}\/work$/,
  )
  assert.equal(data.blocks[0].text, "Hi  ]52;c;evil  there\nline two")
  assert.equal(Array.from(data.blocks[1].text).length, 801)
  const plain = renderPreview(data, { color: false })
  assert.ok(!plain.includes("\u001b"))
  assert.match(plain, /▍You\nHi {2}\]52;c;evil {2}there\nline two/)
  assert.ok(JSON.stringify(data).length < 10000)
  assert.ok(renderPreview(data).includes("\u001b[1;36m▍You\u001b[0m"))
  const narrow = renderPreview(data, { color: false, width: 10 })
  assert.ok(narrow.split("\n").every((line) => Array.from(line).length <= 10))
})

test("the fzf preview helper renders a row's JSON field and tolerates bad input", () => {
  const data = previewData(sample)
  const ok = spawnSync(process.execPath, [PREVIEW, JSON.stringify(data)], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  })
  assert.equal(ok.status, 0)
  assert.match(ok.stdout, /^Fix the build\n/)
  assert.match(ok.stdout, /▍You\nFirst/)
  const bad = spawnSync(process.execPath, [PREVIEW, "{"], { encoding: "utf8" })
  assert.equal(bad.stdout, "(no preview)")
})

test("native rows carry previews as a fifth field only when enabled", () => {
  const entry = { display: "d", searchable: "s", preview: previewData(sample) }
  const fields = nativeRow(entry, 7).trimEnd().split("\t")
  assert.equal(fields.length, 5)
  assert.equal(fields[3], "7")
  assert.deepEqual(JSON.parse(fields[4]), entry.preview)
  assert.equal(
    nativeRow({ display: "d", searchable: "s" }, 7).split("\t").length,
    4,
  )

  const withPreview = nativeArgs("fzf", "opencode", false, "", true)
  assert.ok(
    withPreview.some(
      (arg) => arg.startsWith("--preview=") && arg.endsWith("{5}"),
    ),
  )
  assert.ok(withPreview.includes("--bind=ctrl-/:toggle-preview"))
  assert.ok(withPreview.includes("--with-shell=/bin/sh -c"))
  assert.ok(
    !nativeArgs("fzf", "opencode", false, "").some((arg) =>
      arg.startsWith("--preview"),
    ),
  )
})

test("directory filters match the directory itself and anything below it", () => {
  assert.ok(inDirectories("/work/app", ["/work/app"]))
  assert.ok(inDirectories("/work/app/src/", ["/work/app"]))
  assert.ok(!inDirectories("/work/application", ["/work/app"]))
  assert.ok(!inDirectories("", ["/work/app"]))
  assert.ok(inDirectories("", undefined))
  assert.ok(inDirectories("/elsewhere", ["/work/app", "/elsewhere"]))
})

test("--last picks the newest chat across both sources and tolerates a missing store", () =>
  temporary(async (root) => {
    const options = await bothFixtures(root)
    // Codex rollouts are newer than the OpenCode fixture (time_updated 200);
    // make `main` the newest Codex chat.
    await utimes(join(options.codexHome, "sessions/other.jsonl"), 100, 100)
    let result = await invoke(["--last", "--stdout", ...stores(options)])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.ok(result.stdout.startsWith("Codex question 🦉"))

    for (const file of ["main.jsonl", "other.jsonl", "child.jsonl"]) {
      const path = join(options.codexHome, "sessions", file)
      await utimes(path, 0, 0)
    }
    result = await invoke(["--last", "--stdout", ...stores(options)])
    assert.equal(result.stdout, "OpenCode question 🦉\n\n\n\nOpenCode answer")

    result = await invoke([
      "--last",
      "--stdout",
      "--codex-home",
      join(root, "ABSENT"),
      "--db",
      options.openCodeDb,
    ])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.ok(result.stdout.startsWith("OpenCode question"))

    result = await invoke([
      "--last",
      "--provider",
      "codex",
      "--stdout",
      ...stores(options),
    ])
    assert.ok(result.stdout.startsWith("Codex question"))

    result = await invoke([
      "--last",
      "--stdout",
      "--codex-home",
      join(root, "ABSENT"),
      "--db",
      join(root, "ABSENT.db"),
    ])
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /No Codex or OpenCode chat store was found/)

    result = await invoke([
      "--last",
      "--provider",
      "codex",
      "--stdout",
      "--codex-home",
      join(root, "ABSENT"),
    ])
    assert.equal(result.exitCode, 1)
    assert.match(result.stderr, /Codex directory not found/)
  }))

test("--here uses the enclosing git project and --cwd filters by path", () =>
  temporary(async (root) => {
    const options = await bothFixtures(root)
    const project = join(root, "project")
    await mkdir(join(project, ".git"), { recursive: true })
    await mkdir(join(project, "src/deep"), { recursive: true })
    await rollout(join(options.codexHome, "sessions/here.jsonl"), [
      meta("here", "2026-09-05T10:00:00Z", { cwd: join(project, "src") }),
      event("UserMessage", "Project question"),
    ])
    await utimes(join(options.codexHome, "sessions/here.jsonl"), 0, 0)

    let result = await invoke(
      [
        "--last",
        "--here",
        "--provider",
        "codex",
        "--stdout",
        ...stores(options),
      ],
      { cwd: join(project, "src/deep") },
    )
    assert.equal(result.exitCode, 0, result.stderr)
    assert.equal(result.stdout, "Project question")

    result = await invoke([
      "--list",
      "--provider",
      "codex",
      "--cwd",
      project,
      ...stores(options),
    ])
    assert.equal(result.stdout.split("\n")[0].split("\t")[0], "here")
    assert.equal(result.stdout.trim().split("\n").length, 1)

    result = await invoke([
      "--list",
      "--provider",
      "opencode",
      "--cwd",
      "/test",
      ...stores(options),
    ])
    assert.deepEqual(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => line.split("\t")[0]),
      ["root", "fork"],
    )

    result = await invoke([
      "--last",
      "--cwd",
      join(root, "nowhere"),
      "--stdout",
      ...stores(options),
    ])
    assert.equal(result.exitCode, 1)
    assert.match(
      result.stderr,
      /No main chats with visible text were found in /,
    )
  }))

test("--output writes the chosen format to a file and reports it on stdout", () =>
  temporary(async (root) => {
    const options = await bothFixtures(root)
    const file = join(root, "out/chat.md")
    await mkdir(join(root, "out"))
    let result = await invoke([
      "--provider",
      "opencode",
      "--session",
      "root",
      "--format",
      "markdown",
      "-o",
      file,
      ...stores(options),
    ])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.match(
      result.stdout,
      /^Wrote 2 text parts from OpenCode: .*\n {2}-> .*chat\.md\n$/,
    )
    assert.match(
      await readFile(file, "utf8"),
      /^# Main chat\n\n- \*\*Source:\*\* OpenCode\n- \*\*Session:\*\* `root`\n- \*\*Directory:\*\* `\/test`\n- \*\*Updated:\*\* \d{4}-\d\d-\d\d \d\d:\d\d\n\n---\n\n## User\n\nOpenCode question 🦉\n\n## Assistant\n\nOpenCode answer\n$/,
    )

    result = await invoke(
      [
        "--provider",
        "codex",
        "--session",
        "main",
        "--format",
        "json",
        "--output",
        "rel.json",
        ...stores(options),
      ],
      { cwd: root },
    )
    assert.equal(result.exitCode, 0, result.stderr)
    const value = JSON.parse(await readFile(join(root, "rel.json"), "utf8"))
    assert.deepEqual(
      value.records.map((record) => record.role),
      ["user", "assistant"],
    )
  }))

test("new options reject unsupported combinations with usage errors", async () => {
  for (const [args, message] of [
    [["--format", "html"], /--format must be text, markdown, or json/],
    [["--list", "--format", "json"], /--list cannot be combined with --format/],
    [["--list", "--last"], /--list cannot be combined with --last/],
    [["--list", "-o", "x"], /--list cannot be combined with --output/],
    [["--stdout", "-o", "x"], /--stdout cannot be combined with --output/],
    [["-o", ""], /--output needs a file path/],
    [["--here", "--cwd", "/x"], /--here cannot be combined with --cwd/],
    [["--session", "x", "--last"], /--session cannot be combined with --last/],
    [["--session", "x", "--here"], /--session cannot be combined with --here/],
    [["--user-only", "--tools"], /--user-only cannot be combined with --tools/],
  ]) {
    const result = await invoke(args)
    assert.equal(result.exitCode, 2, args.join(" "))
    assert.equal(result.stdout, "")
    assert.match(result.stderr, message)
  }
})

test("no mode of the CLI modifies the chat stores, including a live WAL database", () =>
  temporary(async (root) => {
    const options = await bothFixtures(root)
    const walDb = join(root, "wal/opencode.db")
    const writer = await database(walDb, true)
    writer.message("u", 1)
    writer.part("p", "u", "Live WAL text")
    const tool = { status: "completed", input: { command: "ls" }, output: "x" }
    writer.message("a", 2, "assistant")
    writer.part("t", "a", "", "tool", "root", { tool: "bash", state: tool })
    try {
      const before = await fingerprint(root)
      const runs = [
        ["--provider", "codex", "--list", "--json"],
        ["--provider", "opencode", "--list", "--cwd", "/test"],
        ["--last", "--stdout", "--tools", "--format", "markdown"],
        ["--last", "--here", "--stdout"],
        [
          "--provider",
          "codex",
          "--session",
          "main",
          "--stdout",
          "--format",
          "json",
          "--tools",
        ],
        [
          "--provider",
          "opencode",
          "--session",
          "root",
          "--stdout",
          "--user-only",
        ],
        [
          "--provider",
          "opencode",
          "--session",
          "root",
          "--stdout",
          "--no-reasoning",
        ],
      ]
      for (const args of runs) {
        await invoke([...args, ...stores(options)], { cwd: root })
      }
      const wal = await invoke([
        "--provider",
        "opencode",
        "--session",
        "root",
        "--stdout",
        "--tools",
        "--db",
        walDb,
      ])
      assert.equal(wal.exitCode, 0, wal.stderr)
      assert.equal(
        wal.stdout,
        "Live WAL text\n\n\n\n[Tool: bash]\n$ ls\nOutput:\nx",
      )
      const outFile = join(root, "export.txt")
      await invoke(["--last", "-o", outFile, ...stores(options)])
      const after = await fingerprint(root)
      delete after[outFile]
      // SQLite's -shm file is a shared-memory index that every reader
      // (OpenCode included) updates; it holds no chat data and is rebuilt
      // from the database and WAL. Everything else must be byte-identical.
      const shm = (value) =>
        Object.fromEntries(
          Object.entries(value).filter(([path]) => !path.endsWith("-shm")),
        )
      assert.deepEqual(shm(after), shm(before))
      assert.ok(Object.keys(shm(before)).some((path) => path.endsWith("-wal")))
    } finally {
      writer.close()
    }
  }))

test("the executable supports new flags end to end without a terminal", () =>
  temporary(async (root) => {
    const options = await bothFixtures(root)
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        "--last",
        "--provider",
        "opencode",
        "--format",
        "json",
        "--stdout",
        ...stores(options),
      ],
      { encoding: "utf8", env: { ...process.env, PATH: "" } },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).records.length, 2)
  }))

test("sessions in an unrecognized OpenCode format are skipped by the picker and --last, not fatal", () =>
  temporary(async (root) => {
    const options = await bothFixtures(root)
    const writer = await writable(options.openCodeDb)
    try {
      writer.run(
        "INSERT INTO session VALUES('newer',NULL,'Newer chat','/test',900,NULL,NULL)",
      )
      writer.run("INSERT INTO session_message VALUES('sm','newer',1,'{}')")
    } finally {
      writer.close()
    }
    const skipped = []
    const entries = []
    for await (const entry of indexChats(
      { mode: "index", provider: "opencode", options },
      undefined,
      (count) => skipped.push(count),
    )) {
      entries.push(entry.id)
    }
    assert.deepEqual(entries, ["root"])
    assert.deepEqual(skipped, [1])

    const result = await invoke([
      "--last",
      "--provider",
      "opencode",
      "--stdout",
      ...stores(options),
    ])
    assert.equal(result.exitCode, 0, result.stderr)
    assert.ok(result.stdout.startsWith("OpenCode question"))
    assert.match(
      result.stderr,
      /^Note: skipped 1 OpenCode chat stored in a format chat-export does not recognize/,
    )

    const direct = await invoke([
      "--provider",
      "opencode",
      "--session",
      "newer",
      "--stdout",
      ...stores(options),
    ])
    assert.equal(direct.exitCode, 1)
    assert.equal(direct.stdout, "")
    assert.match(
      direct.stderr,
      /newer message format; refusing a partial export/,
    )
  }))
