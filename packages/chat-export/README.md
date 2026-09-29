# chat-export

<!-- prettier-ignore -->
Search your local Codex and OpenCode chats and export one as plain text, Markdown, or JSON.

Choose **Codex** or **OpenCode**, search, then select a chat. The full
transcript is copied to the clipboard, printed with `--stdout`, or written to a
file with `-o`. `--last` skips the picker and grabs your most recent chat.

It uses native **fzf 0.74+** when available. Without it, **Inquirer** provides
the source menu and a searchable chat picker using the JavaScript fzf matcher.
A small Inquirer-core search component prevents acceptance of stale results.
Both pickers show a preview of the highlighted chat. No Python or native npm
add-on is needed at runtime.

## Requirements

- Node.js 22.13+ (22 LTS, or 23.5 and newer), or Bun 1.3.14+
- Optional: [fzf](https://github.com/junegunn/fzf) 0.74+ for the native picker
- A clipboard helper: `pbcopy` on macOS, or `wl-copy`, `xclip` or `xsel` on
  Linux. Use `--stdout` or `-o` when none is available

## Install and run

Run the package without installing it globally:

```bash
npx @nocdn/chat-export
```

Or install it globally and use its executable:

```bash
npm install --global @nocdn/chat-export
chat-export
```

Other package runners such as `bunx`, `pnpm dlx`, and `yarn dlx` can run the
same package.

Use arrow keys and Enter to select. Escape cancels. In native fzf, the preview
sits beside the list (or below it in narrow terminals) and Ctrl-/ toggles it.
In the native Codex picker, Escape during Enter's brief search wait cancels the
pending selection; another Escape closes the picker.

## Usage

```text
chat-export [options]
```

Choosing a chat:

| Option                         | Description                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `--provider codex\|opencode`   | Skip the source menu.                                                                                   |
| `--picker auto\|fzf\|inquirer` | Prefer fzf automatically (default), or force a picker.                                                  |
| `--session ID`                 | Export one main chat without its picker.                                                                |
| `--last`                       | Export the most recent chat without a picker. Without `--provider`, it compares both sources.           |
| `--here`                       | Only chats from the current project: the nearest directory containing `.git`, or the current directory. |
| `--cwd PATH`                   | Only chats started in `PATH` or a directory below it.                                                   |
| `--list`                       | List main session IDs; never touches the clipboard.                                                     |
| `--json`                       | JSON metadata with `--list`.                                                                            |
| `--exact`                      | Literal substring search (smart case).                                                                  |
| `--query TEXT`                 | Start with a chat search.                                                                               |
| `--no-preview`                 | Hide the chat preview in the picker.                                                                    |

Output:

| Option                          | Description                                      |
| ------------------------------- | ------------------------------------------------ |
| `--stdout`                      | Print the transcript instead of copying it.      |
| `-o`, `--output FILE`           | Write the transcript to `FILE` (overwriting it). |
| `--format text\|markdown\|json` | Export format (default: `text`).                 |

Content:

| Option           | Description                                         |
| ---------------- | --------------------------------------------------- |
| `--no-reasoning` | Omit reasoning from search, preview, and export.    |
| `--user-only`    | Only your own messages (handy for reusing prompts). |
| `--tools`        | Include tool calls and their output.                |

Stores and general:

| Option              | Description                            |
| ------------------- | -------------------------------------- |
| `--codex-home PATH` | Override `CODEX_HOME` / `~/.codex`.    |
| `--db PATH`         | Override the OpenCode SQLite database. |
| `-h`, `--help`      | Show help.                             |
| `-v`, `--version`   | Show the package version.              |

Examples:

```bash
chat-export --here --last                         # newest chat for this repo, copied
chat-export --last --format markdown -o chat.md   # newest chat as a Markdown file
chat-export --provider codex --here --tools       # pick a chat, including commands and edits
chat-export --provider opencode --user-only       # just your prompts from a chat
chat-export --provider codex --list --cwd ~/code/app
chat-export --provider opencode --session ses_... --format json --stdout
```

### Formats

- **text** (default) is the plain transcript, unchanged from earlier versions:
  turns separated by blank lines, with reasoning and tool activity inline
- **markdown** adds a title and metadata (source, session, directory, updated
  time), `## User` / `## Assistant` headings, and folds reasoning and each tool
  call into a `<details>` block. Tool input and output are fenced so code in
  them cannot break the document
- **json** is `{ provider, id, title, directory, updatedAt, records }`, where
  each record has a `role` (`user`, `assistant`, `reasoning`, `tool`) and
  `text`; tool records also carry `tool: { name, summary, input, output, lang,
failed }`

### Content

`--tools` is off by default. With it:

- **Codex:** shell commands (with their output and exit status), file edits
  (as unified diffs), MCP tool calls, web searches, and viewed images. Older
  rollouts without structured events fall back to raw model tool calls paired
  with their outputs
- **OpenCode:** every tool part (`bash`, `edit`, `read`, `grep`, and so on),
  with its input, output, or error

Tool output can be large, so exports and the search index grow accordingly.
`--user-only` keeps only your messages and cannot be combined with `--tools`.

Without `--exact`, Codex supports double-quoted phrase searches in chat text.
OpenCode uses ordinary fzf search and its explicit `--exact` mode. Fuzzy
ranking can differ slightly between native fzf and the JavaScript matcher.
There is no result-count or transcript-length cap; long lists are paginated.
Previews show the beginning of a chat, shortened; the export itself is not.

Transcripts, `--list` output, and the "Copied"/"Wrote" confirmations go to
stdout; errors and notes go to stderr. Unknown options, positional arguments,
and invalid option values or combinations exit with status 2. Reader and export
errors exit with status 1, and cancelling a picker exits with status 130
without copying anything. The picker needs a terminal; in scripts, use
`--last`, `--list`, or `--provider` with `--session ID`.

## Data and compatibility

- Chat stores are only ever read. Codex rollouts are opened read-only, and
  SQLite opens read-only with `query_only`, allowing only read queries and
  short read transactions. The only file chat-export writes is your `-o` file
- Codex keeps its event/fallback selection, fragment merging,
  normalized-text deduplication, formatting, and placement of trailing
  reasoning. The dedupe behavior is deliberate: this is not a raw log export.
  With `--tools`, tool calls are kept per call, so repeated commands stay
- OpenCode orders messages by creation time and ID, then parts by ID. Repeated
  text stays intact. Child sessions, synthetic/ignored text, and compaction
  summaries are excluded; tool parts are excluded unless `--tools` is set.
  Attachments appear as labels, not binary data
- Readers include the complete stored main-chat text under those rules.
  Display previews are shortened, but the search text and copied transcript
  are not
- A selected chat is reread before copying. Codex rediscovers moved/new
  fragments and rejects refreshes that lose previously indexed text. Reopening
  the picker establishes a new baseline after an intentional history removal
- File reads use a bounded prefix from the opened file
- Committed WAL data is included. `immutable=1`, migrations, checkpoints,
  repairs, extension loading, and app configuration changes are not used
- No transcript cache or network service is created. Indexing runs in a
  worker; native fzf receives chats incrementally. Previews travel with each
  picker row, so moving through the list never rereads the stores. Chat text
  in previews is stripped of terminal control sequences
- Incomplete refreshes and invalid Unicode fail before copying rather than
  producing a silently shortened or lossy export

The OpenCode reader targets the SQLite `session` / `message` / `part` layout.
Some OpenCode versions (around 1.18.16 to 1.18.25) also wrote chats to a newer
`session_v2` / `session_message` layout, sometimes to only one of the two.
chat-export reads both and merges them: messages present in both are taken
once (they share IDs), and messages found only in the newer layout are placed
by creation time. The newer layout's text, reasoning, tool calls, and
attachment labels follow the same rules as above; synthetic and compaction
messages are excluded. Chats that exist only in the newer layout are listed
too.

If that layout has an unexpected shape, or a chat contains something the
reader does not understand (an unknown message or content type, or a revert
that would need both layouts to resolve), chat-export refuses instead of
producing a partial transcript. The picker and `--last` skip such chats and
print a note on stderr with the count; `--session` fails with an explicit
unsupported-format error.

Node 22 prints its standard `node:sqlite` experimental warning on stderr. The
native fzf integration expects a POSIX shell. macOS has been exercised; other
operating systems have not.

## Develop

Install the exact dependency tree from the repository's `package-lock.json`:

```bash
# from the repository root
npm install
npm test --workspace packages/chat-export
npm start --workspace packages/chat-export -- --help
```

The executable adapter lives in [`bin/cli.js`](./bin/cli.js), and the testable
option handling lives in [`src/cli.js`](./src/cli.js). The rest of `src/` is
split by concern:

- `src/providers/` — Codex rollout reader, OpenCode reader, read-only SQLite
- `src/pickers/` — native fzf picker, Inquirer fallback, and its matcher
- `src/worker.js` / `src/worker-client.js` — indexing and export in a worker
- `src/render.js` — Markdown, JSON, and preview rendering
- `src/tools.js` — the shared shape of tool records
- `src/fzf-query.js` / `src/fzf-preview.js` — helpers native fzf runs for
  Codex quoted-phrase search and the preview pane

The project uses plain ESM JavaScript, so publishing does not require a build
step. Runtime dependencies are limited to `fzf`, `@inquirer/core`, and
`@inquirer/select`.

Available checks:

```bash
# from the repository root
npm test --workspace packages/chat-export
npm run lint
npm run check
npm run format
npm pack --dry-run --workspace packages/chat-export
```

Tests use Node's built-in test runner and create disposable stores. They never
read real chats or overwrite the system clipboard. Coverage includes ordering,
batch boundaries, Unicode and whitespace, fragment refresh, subagent filtering,
live WAL reads, concurrent writers, malformed data, worker cancellation, full
text searching, both OpenCode storage layouts and their merge, noninteractive CLI exports, every output format, tool
extraction for both sources, directory filters, `--last`, previews, and a
check that no CLI mode changes the bytes of a chat store.

Optional real-terminal checks drive the CLI in a pseudo-terminal with native
fzf and with the automatic Inquirer fallback, for both providers and runtimes,
including that the preview renders (Python is only the test driver):

```bash
python3 scripts/verify-terminal.py
python3 scripts/verify-terminal.py --runtime node --picker fzf
```

`scripts/compare-oracle.js` compares exports against a hash/count oracle file
(no chat text) for live parity checks.

## Publishing

This package lives in the [nocdn/packages](https://github.com/nocdn/packages)
monorepo. To release it, bump `version` in this `package.json` and push to
`main`. The repository's publish workflow releases every version that is not
on npm yet with npm trusted publishing, so there is no npm token and every
release has provenance. See the [repository README](../../README.md#releasing).
