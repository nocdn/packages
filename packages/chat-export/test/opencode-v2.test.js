import assert from "node:assert/strict"
import { join } from "node:path"
import test from "node:test"

import { runCli } from "../src/cli.js"
import {
  listOpenCode,
  openOpenCode,
  readOpenCode,
} from "../src/providers/opencode.js"
import { transcript } from "../src/text.js"
import { indexChats } from "../src/worker-client.js"
import { temporary, v2Database } from "./fixtures.js"

async function invoke(args) {
  let stdout = ""
  let stderr = ""
  const exitCode = await runCli(args, {
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

async function read(path, id, reasoning = true, tools = false) {
  const db = await openOpenCode(path)
  try {
    return readOpenCode(db, id, reasoning, tools)
  } finally {
    db.close()
  }
}

// A session written to both layouts, as OpenCode 1.18.16-1.18.25 did: the
// first two messages exist in both, later ones only in the newer layout.
async function dualFixture(root) {
  const path = join(root, "opencode.db")
  const db = await v2Database(path)
  db.message("u", 1)
  db.message("a", 3, "assistant")
  db.part("u1", "u", "First question")
  db.part("a1", "a", "First answer")
  db.session2("root", { title: "Main chat", updated: 500 })
  db.message2("u", 1, "user", { text: "First question" })
  db.message2("a", 3, "assistant", {
    content: [{ type: "text", text: "First answer" }],
  })
  db.message2("syn", 4, "synthetic", { text: "SYNTHETIC" })
  db.message2("cmp", 5, "compaction", { summary: "COMPACTED" })
  db.message2("sys", 5, "system", { text: "SYSTEM NOTICE" })
  db.message2("unk", 5, "mystery", { text: "UNKNOWN ROW" })
  db.message2("u2", 6, "user", {
    text: "Second question",
    files: [
      { name: "a.txt", mime: "text/plain", data: "QUJD", source: {} },
      { mime: "image/png", source: { path: "/tmp/shot.png" } },
    ],
  })
  db.message2("a2", 7, "assistant", {
    content: [
      { type: "reasoning", text: "Thinking it over" },
      {
        type: "tool",
        id: "call_1",
        name: "bash",
        state: {
          status: "completed",
          input: { command: "ls -1" },
          content: [{ type: "text", text: "a.txt\nnotes.txt" }],
        },
      },
      {
        type: "tool",
        id: "call_2",
        name: "read",
        state: {
          status: "error",
          input: { filePath: "missing.txt" },
          error: { type: "unknown", message: "File not found" },
        },
      },
      { type: "text", text: "Second answer" },
    ],
  })
  // Interleaves by creation time with the newer-only messages.
  db.message("u3", 8)
  db.part("u3a", "u3", "Third question")
  return { db, path }
}

test("OpenCode sessions in both layouts merge by message ID and time", () =>
  temporary(async (root) => {
    const { db, path } = await dualFixture(root)
    db.close()
    const chat = await read(path, "root")
    assert.equal(chat.updatedAt, 500)
    assert.equal(
      transcript(chat),
      [
        "First question",
        "First answer",
        "Second question\n\n[Attachment: a.txt (text/plain)]\n\n[Attachment: shot.png (image/png)]",
        "Thinking it over\n\nSecond answer",
        "Third question",
      ].join("\n\n\n\n"),
    )
    assert.doesNotMatch(
      transcript(chat),
      /SYNTHETIC|COMPACTED|SYSTEM NOTICE|UNKNOWN ROW|QUJD/,
    )
    assert.doesNotMatch(transcript(await read(path, "root", false)), /Thinking/)

    const tools = await read(path, "root", true, true)
    const calls = tools.records.filter((record) => record.kind === "tool")
    assert.deepEqual(
      calls.map((record) => [
        record.key,
        record.tool.name,
        record.tool.input,
        record.tool.output,
        record.tool.failed,
      ]),
      [
        ["tool:call_1", "bash", "$ ls -1", "a.txt\nnotes.txt", false],
        [
          "tool:call_2",
          "read",
          '{\n  "filePath": "missing.txt"\n}',
          "File not found",
          true,
        ],
      ],
    )
  }))

test("OpenCode lists and exports sessions stored only in the newer layout", () =>
  temporary(async (root) => {
    const { db, path } = await dualFixture(root)
    db.session2("fresh", { slug: "calm-harbor", updated: 900 })
    db.message2("f1", 1, "user", { text: "Fresh question" }, "fresh")
    db.message2(
      "f2",
      2,
      "assistant",
      { content: [{ type: "text", text: "Fresh answer" }] },
      "fresh",
    )
    db.session2("sub", { parent: "fresh", updated: 950 })
    db.message2("s1", 1, "user", { text: "CHILD" }, "sub")
    db.close()

    const reader = await openOpenCode(path)
    try {
      assert.deepEqual(
        listOpenCode(reader).map((chat) => [chat.id, chat.title]),
        [
          ["fresh", "calm-harbor"],
          ["root", "Main chat"],
          ["fork", "Fork chat"],
        ],
      )
      assert.throws(() => readOpenCode(reader, "sub"), /Child\/subagent/)
    } finally {
      reader.close()
    }

    const skipped = []
    const ids = []
    for await (const entry of indexChats(
      {
        mode: "index",
        provider: "opencode",
        options: { openCodeDb: path, reasoning: true },
      },
      undefined,
      (count) => skipped.push(count),
    )) {
      ids.push(entry.id)
    }
    assert.deepEqual(ids, ["fresh", "root"])
    assert.deepEqual(skipped, [])

    const last = await invoke([
      "--provider",
      "opencode",
      "--db",
      path,
      "--last",
      "--stdout",
      "--format",
      "json",
    ])
    assert.equal(last.exitCode, 0, last.stderr)
    assert.equal(last.stderr, "")
    const json = JSON.parse(last.stdout)
    assert.equal(json.id, "fresh")
    assert.deepEqual(
      json.records.map((record) => record.text),
      ["Fresh question", "Fresh answer"],
    )
  }))

test("OpenCode refuses newer-layout data it cannot export in full", () =>
  temporary(async (root) => {
    const refusals = [
      [
        "an unknown content type",
        (db) =>
          db.message2("odd", 9, "assistant", {
            content: [{ type: "hologram" }],
          }),
        /Unsupported OpenCode content type/,
      ],
      [
        "a revert in the newer layout",
        (db) => db.run('UPDATE session_v2 SET revert=\'{"messageID":"a"}\''),
        /revert in the newer message format/,
      ],
      [
        "a v1 revert mixed with newer-only messages",
        (db) =>
          db.run(
            "UPDATE session SET revert='{\"messageID\":\"a\"}' WHERE id='root'",
          ),
        /mixes a revert with newer-format messages/,
      ],
      [
        "unreadable message data",
        (db) => db.run("UPDATE session_message SET data='{' WHERE id='u2'"),
        /Invalid OpenCode message data/,
      ],
    ]
    for (const [label, mutate, error] of refusals) {
      const directory = join(root, label.replaceAll(" ", "-"))
      const { db, path } = await dualFixture(directory)
      mutate(db)
      db.close()
      await assert.rejects(read(path, "root"), error, label)
      const result = await invoke([
        "--provider",
        "opencode",
        "--db",
        path,
        "--session",
        "root",
        "--stdout",
      ])
      assert.equal(result.exitCode, 1, label)
      assert.equal(result.stdout, "", label)
    }
  }))
