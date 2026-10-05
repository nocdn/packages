import { test } from "node:test"
import assert from "node:assert/strict"
import {
  open,
  readFile,
  appendFile,
  rename,
  mkdir,
  unlink,
  access,
} from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import process from "node:process"
import { fileURLToPath, URL } from "node:url"
import {
  temporary,
  meta,
  event,
  fallback,
  rollout,
  database,
  bothFixtures,
} from "./fixtures.js"
import {
  boundedLines,
  loadCodex,
  parseCodex,
  refreshCodex,
} from "../src/providers/codex.js"
import { openReadDatabase } from "../src/providers/sqlite.js"
import {
  listOpenCode,
  MESSAGE_BATCH_SIZE,
  openOpenCode,
  readOpenCode,
} from "../src/providers/opencode.js"
import { compact, fzfQuery, indexEntry, transcript } from "../src/text.js"
import { ChatMatcher } from "../src/pickers/matcher.js"
import { nativeArgs, nativeRow } from "../src/pickers/native.js"
import { indexChats, runJob } from "../src/worker-client.js"

test("Codex preserves legacy event preference, fragments, dedupe and trailing reasoning", () =>
  temporary(async (root) => {
    const first = join(root, "sessions/day/first.jsonl"),
      second = join(root, "archived_sessions/second.jsonl")
    await rollout(first, [
      meta(),
      fallback("user", "MIRROR"),
      event("UserMessage", "Repeat me"),
      event("AgentMessage", "First answer"),
      event("UserMessage", "Repeat me"),
    ])
    await rollout(second, [
      meta("main", "2026-09-02T10:00:00Z"),
      fallback("user", "Repeat me"),
      fallback("user", "<environment_context>hidden"),
      fallback("assistant", "Final answer"),
      {
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "Trailing reasoning" }],
        },
      },
    ])
    const chats = await loadCodex(root)
    assert.equal(chats.length, 1)
    assert.deepEqual(chats[0].paths, [first, second])
    assert.deepEqual(
      chats[0].records.map((r) => [r.kind, r.text]),
      [
        ["user", "Repeat me"],
        ["assistant", "First answer"],
        ["reasoning", "Trailing reasoning"],
        ["assistant", "Final answer"],
      ],
    )
    assert.equal(
      transcript(chats[0]),
      "Repeat me\n\n\n\nFirst answer\n\nTrailing reasoning\n\nFinal answer",
    )
  }))

test("Codex handles non-objects, incomplete tails, UTF-8 chunk boundaries and bounded appends", () =>
  temporary(async (root) => {
    const path = join(root, "sessions/main.jsonl")
    const body = "a".repeat(65501) + "🦉 Zażółć\n```ts\n  code()\n```"
    await rollout(
      path,
      [meta(), [], null, event("UserMessage", body)],
      '{"type":"event_msg"',
    )
    const chat = await parseCodex(path)
    assert.equal(chat.records[0].text, body)
    const file = await open(path, "r")
    try {
      const { size } = await file.stat()
      await appendFile(
        path,
        "\n" + JSON.stringify(event("UserMessage", "LATER")) + "\n",
      )
      const captured = []
      for await (const line of boundedLines(file, size)) captured.push(line)
      assert.ok(!captured.join("").includes("LATER"))
    } finally {
      await file.close()
    }
    const child = join(root, "sessions/child.jsonl")
    await rollout(child, [
      meta("child", undefined, { source: { subagent: { thread_spawn: {} } } }),
      event("UserMessage", "INHERITED"),
    ])
    assert.equal(await parseCodex(child), undefined)
    assert.equal(
      compact("\u0085 \u001c hello\u00a0there \u3000"),
      "hello there",
    )
  }))

test("Codex refresh recovers moved/new fragments and rejects loss", () =>
  temporary(async (root) => {
    const first = join(root, "sessions/first.jsonl"),
      second = join(root, "sessions/second.jsonl")
    await rollout(first, [meta(), event("UserMessage", "First")])
    await rollout(second, [
      meta("main", "2026-09-02T00:00:00Z"),
      fallback("assistant", "Second"),
    ])
    const selected = indexEntry((await loadCodex(root))[0])
    await mkdir(join(root, "archived_sessions"))
    await rename(second, join(root, "archived_sessions/second.jsonl"))
    await rollout(join(root, "sessions/new.jsonl"), [
      meta("main", "2026-09-03T00:00:00Z"),
      event("UserMessage", "New"),
    ])
    assert.equal(
      transcript(await refreshCodex(root, "main", selected.guard)),
      "First\n\n\n\nSecond\n\n\n\nNew",
    )
    await unlink(first)
    await assert.rejects(
      refreshCodex(root, "main", selected.guard),
      /read in full/,
    )
  }))

test("OpenCode preserves ordering, repeated text, formatting and exclusions", () =>
  temporary(async (root) => {
    const path = join(root, "chat #1 ?.db"),
      writer = await database(path)
    try {
      writer.message("c", 30, "assistant")
      writer.message("z", 10)
      writer.message("b", 30)
      writer.message("a", 20, "assistant")
      writer.message("summary", 40, "assistant", "root", { summary: true })
      writer.message("child-msg", 1, "assistant", "child")
      writer.part("cz", "c", "again")
      writer.part("zu", "z", "again")
      writer.part("bu", "b", "    indented\nkeep two spaces  \nZażółć 🦉")
      writer.part("a3", "a", "```python\n    print('hello')\n```\n\nParagraph")
      writer.part("a2", "a", "Second thought", "reasoning")
      writer.part("a1", "a", "First thought", "reasoning")
      writer.part("a4", "a", "SUBAGENT RESULT", "tool", "root", {
        tool: "task",
      })
      writer.part("a5", "a", "HIDDEN", "text", "root", { synthetic: true })
      writer.part("a6", "a", "IGNORED", "text", "root", { ignored: true })
      writer.part("a7", "a", "CONTINUE", "text", "root", {
        metadata: { compaction_continue: true },
      })
      writer.part("ss", "summary", "COMPACTION SUMMARY")
      writer.part("cc", "child-msg", "CHILD OUTPUT", "text", "child")
      const db = await openOpenCode(path)
      try {
        const chat = readOpenCode(db, "root")
        assert.deepEqual(
          chat.records.map((r) => r.partId),
          ["zu", "a1", "a2", "a3", "bu", "cz"],
        )
        assert.equal(
          transcript(chat),
          "again\n\n\n\nFirst thought\nSecond thought\n\n```python\n    print('hello')\n```\n\nParagraph\n\n\n\n    indented\nkeep two spaces  \nZażółć 🦉\n\n\n\nagain",
        )
        assert.ok(
          !readOpenCode(db, "root", false).records.some(
            (r) => r.kind === "reasoning",
          ),
        )
        assert.deepEqual(
          listOpenCode(db).map((c) => c.id),
          ["root", "fork"],
        )
        assert.throws(() => readOpenCode(db, "child"), /Child\/subagent/)
      } finally {
        db.close()
      }
    } finally {
      writer.close()
    }
  }))

test("OpenCode includes all batches and attachment labels without binary data", () =>
  temporary(async (root) => {
    const path = join(root, "chat.db"),
      writer = await database(path)
    try {
      for (let i = MESSAGE_BATCH_SIZE + 2; i >= 0; i--) {
        const id = String(i).padStart(4, "0")
        writer.message(id, i)
        writer.part("p" + id, id, "message " + i)
      }
      writer.part("zz", "0258", "", "file", "root", {
        filename: "image.png",
        mime: "image/png",
        url: "data:image/png;base64,PRIVATEBINARY",
      })
      const db = await openOpenCode(path)
      try {
        const records = readOpenCode(db, "root").records
        assert.deepEqual(
          records.slice(0, -1).map((r) => r.text),
          Array.from(
            { length: MESSAGE_BATCH_SIZE + 3 },
            (_, i) => "message " + i,
          ),
        )
        assert.equal(records.at(-1).text, "[Attachment: image.png (image/png)]")
      } finally {
        db.close()
      }
    } finally {
      writer.close()
    }
  }))

test("read-only guards include live WAL data and leave source bytes unchanged", () =>
  temporary(async (root) => {
    const path = join(root, "chat.db"),
      writer = await database(path, true)
    const digest = async (p) =>
      createHash("sha256")
        .update(await readFile(p))
        .digest("hex")
    try {
      writer.message("u", 1)
      writer.part("p", "u", "Present in WAL")
      const before = [await digest(path), await digest(path + "-wal")]
      const db = await openOpenCode(path)
      try {
        assert.equal(transcript(readOpenCode(db, "root")), "Present in WAL")
        for (const sql of [
          "DELETE FROM message",
          "CREATE TABLE bad(x)",
          "PRAGMA query_only=OFF",
          "ATTACH DATABASE ':memory:' AS other",
        ])
          assert.throws(() => db.all(sql), /read queries/)
        assert.throws(() => db.transaction("COMMIT"), /read transactions/)
      } finally {
        db.close()
      }
      assert.deepEqual(
        [await digest(path), await digest(path + "-wal")],
        before,
      )
      assert.equal(Object.values(writer.get("PRAGMA integrity_check"))[0], "ok")
      const missing = join(root, "missing.db")
      await assert.rejects(openReadDatabase(missing), /not found/)
      await assert.rejects(access(missing))
    } finally {
      writer.close()
    }
  }))

test("each OpenCode read is consistent while a separate writer updates it", () =>
  temporary(async (root) => {
    const path = join(root, "chat.db"),
      writer = await database(path, true)
    try {
      writer.message("u", 1)
      writer.part("p", "u", "Original")
      const db = await openOpenCode(path)
      let advanced = false
      const concurrent = {
        ...db,
        all(sql, args) {
          const result = db.all(sql, args)
          if (!advanced && sql.includes("FROM message WHERE")) {
            advanced = true
            writer.run("UPDATE part SET data=? WHERE id=?", [
              JSON.stringify({ type: "text", text: "Updated" }),
              "p",
            ])
            writer.message("a", 2, "assistant")
            writer.part("q", "a", "New reply")
          }
          return result
        },
      }
      try {
        assert.equal(transcript(readOpenCode(concurrent, "root")), "Original")
        assert.equal(
          transcript(readOpenCode(db, "root")),
          "Updated\n\n\n\nNew reply",
        )
      } finally {
        db.close()
      }
    } finally {
      writer.close()
    }
  }))

test("reverts, invalid parts and newer schemas cannot silently produce partial exports", () =>
  temporary(async (root) => {
    const path = join(root, "chat.db"),
      writer = await database(path)
    try {
      writer.message("z", 1)
      writer.message("a", 2, "assistant")
      writer.message("b", 3)
      writer.part("p1", "z", "Question")
      writer.part("p2", "a", "Keep")
      writer.part("p3", "a", "Undo")
      writer.part("p4", "b", "Undo later")
      writer.run("UPDATE session SET revert=? WHERE id=?", [
        JSON.stringify({ messageID: "a", partID: "p3" }),
        "root",
      ])
      const db = await openOpenCode(path)
      try {
        assert.equal(
          transcript(readOpenCode(db, "root")),
          "Question\n\n\n\nKeep",
        )
        writer.run("UPDATE session SET revert=? WHERE id=?", ["{}", "root"])
        assert.equal(readOpenCode(db, "root").records.length, 4)
        writer.run("UPDATE session SET revert=NULL WHERE id=?", ["root"])
        writer.run("UPDATE part SET data=? WHERE id=?", ["{", "p4"])
        assert.throws(() => readOpenCode(db, "root"), /JSON|json/)
        writer.run("UPDATE part SET data=? WHERE id=?", [
          JSON.stringify({ type: "future-type", text: "Future" }),
          "p4",
        ])
        assert.throws(() => readOpenCode(db, "root"), /Unsupported part/)
        writer.run("INSERT INTO session_message VALUES(?,?,?,?)", [
          "future",
          "root",
          1,
          "{}",
        ])
        assert.throws(() => readOpenCode(db, "root"), /newer message format/)
      } finally {
        db.close()
      }
    } finally {
      writer.close()
    }
  }))

test("fallback matches complete long transcripts, literal punctuation, smart case and controls", () => {
  const positive = {
    provider: "codex",
    id: "yes",
    display: "Other title",
    searchable:
      "filler ".repeat(35000) + "James' path\\file cost$ MixedCase 🦉",
    guard: [],
  }
  const negative = {
    provider: "codex",
    id: "no",
    display: "James' path\\file cost$",
    searchable: "James pathfile cost mixedcase reserved \ue000\ue001\ue001",
    guard: [],
  }
  const matcher = new ChatMatcher([negative, positive], false)
  for (const query of [
    "jamespathfile",
    '"mes\'"',
    '"path\\file"',
    '"cost$"',
    '"MixedCase"',
    '"🦉"',
  ])
    assert.ok(
      matcher.find(query).some((r) => r.id === "yes"),
      query,
    )
  for (const query of ['"mes\'"', '"cost$"', '"MixedCase"', '"🦉"'])
    assert.deepEqual(
      matcher.find(query).map((r) => r.id),
      ["yes"],
      query,
    )
  const exact = new ChatMatcher([negative, positive], true)
  assert.deepEqual(
    exact
      .find("James' path\\file cost$")
      .map((r) => r.id)
      .sort(),
    ["no", "yes"],
  )
  assert.equal(
    nativeRow({ ...positive, display: "safe", searchable: "safe" }, 4).split(
      "\t",
    ).length,
    4,
  )
  assert.ok(
    nativeArgs("fzf", "codex", false, "").some((arg) =>
      arg.includes("enter:wait+accept"),
    ),
  )
  assert.ok(fzfQuery('"cost$"').endsWith("$$"))
})

test("searches ignore Markdown syntax in chats and in queries", () => {
  const entry = {
    display: "2026-10-02 12:00  |  Portal  |  /work/my_repo",
    searchable:
      "pinned to **Vite+ 0.3.3**, see [the docs](https://example.com) and `npm run dev`",
  }
  const other = { display: "Other", searchable: "pinned to Vite+ 1.0" }
  const copied = "pinned to Vite+ 0.3.3, see the docs and npm run dev"
  for (const exact of [false, true]) {
    const matcher = new ChatMatcher([entry, other], exact)
    const phrase = (text) => (exact ? text : `"${text}"`)
    assert.deepEqual(matcher.find(phrase(copied)), [entry])
    assert.deepEqual(matcher.find(phrase("**Vite+ 0.3.3**")), [entry])
    assert.deepEqual(matcher.find(phrase("Vite+ 0.3.3")), [entry])
  }
  assert.deepEqual(new ChatMatcher([entry, other], true).find("my_repo"), [
    entry,
  ])
  assert.equal(fzfQuery('"**Vite+ 0.3.3**, see"'), "'Vite+\\ 0.3.3,\\ see")
  assert.equal(fzfQuery("`npm run dev`", true), "npm run dev")
  assert.ok(nativeRow(entry, 0).includes("pinned to Vite+ 0.3.3, see the docs"))
})

test("invalid Unicode cannot silently be replaced in a copied transcript", () => {
  const chat = {
    provider: "codex",
    id: "bad",
    title: "",
    directory: "",
    updatedAt: 1,
    records: [{ kind: "user", text: "unpaired \ud800" }],
  }
  assert.throws(() => transcript(chat), /invalid Unicode/)
  assert.throws(() => indexEntry(chat), /invalid Unicode/)
})

test("worker index closes early and refresh includes new selected content", () =>
  temporary(async (root) => {
    const options = await bothFixtures(root)
    const controller = new AbortController()
    const stream = indexChats(
      { mode: "index", provider: "codex", options },
      controller.signal,
    )
    const entry = (await stream.next()).value
    assert.ok(entry)
    controller.abort()
    await stream.return()
    const entries = []
    for await (const item of indexChats({
      mode: "index",
      provider: "codex",
      options,
    }))
      entries.push(item)
    const selected = entries.find((e) => e.id === "main")
    await rollout(join(options.codexHome, "sessions/new.jsonl"), [
      meta("main", "2026-09-02T00:00:00Z"),
      event("UserMessage", "Added during picker"),
    ])
    const result = await runJob({
      mode: "export",
      provider: "codex",
      options,
      id: "main",
      selected,
    })
    assert.ok(result.transcript.endsWith("\n\n\n\nAdded during picker"))
  }))

test("CLI stdout and list use only the selected store and reject invalid data before output", () =>
  temporary(async (root) => {
    const options = await bothFixtures(root),
      cli = fileURLToPath(new URL("../bin/cli.js", import.meta.url))
    for (const provider of ["codex", "opencode"]) {
      const args = [
        cli,
        "--provider",
        provider,
        "--session",
        provider === "codex" ? "main" : "root",
        "--stdout",
        "--codex-home",
        provider === "codex" ? options.codexHome : join(root, "ABSENT"),
        "--db",
        provider === "opencode" ? options.openCodeDb : join(root, "ABSENT.db"),
      ]
      const result = spawnSync(process.execPath, args, {
        encoding: "utf8",
        env: { ...process.env, PATH: "" },
      })
      assert.equal(result.status, 0, result.stderr)
      assert.ok(
        result.stdout.startsWith(
          provider === "codex" ? "Codex question 🦉" : "OpenCode question 🦉",
        ),
      )
      assert.ok(!result.stdout.includes("CHILD OUTPUT"))
    }
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "--provider",
        "opencode",
        "--db",
        options.openCodeDb,
        "--list",
        "--json",
      ],
      { encoding: "utf8" },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(
      JSON.parse(result.stdout).map((x) => x.id),
      ["root", "fork"],
    )
    const child = spawnSync(
      process.execPath,
      [
        cli,
        "--provider",
        "opencode",
        "--db",
        options.openCodeDb,
        "--session",
        "child",
        "--stdout",
      ],
      { encoding: "utf8" },
    )
    assert.equal(child.status, 1)
    assert.equal(child.stdout, "")
  }))
