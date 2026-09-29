import { access, readFile, realpath, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { URL } from "node:url"
import { parseArgs } from "node:util"

import { Cancelled, ExportError, MissingStore } from "./model.js"
import { PROVIDERS } from "./provider.js"
import { FORMATS, providerName } from "./render.js"
import { oneLine } from "./text.js"

const PICKERS = ["auto", "fzf", "inquirer"]

const options = {
  provider: { type: "string" },
  picker: { type: "string", default: "auto" },
  "codex-home": { type: "string" },
  db: { type: "string" },
  "t3-db": { type: "string" },
  session: { type: "string" },
  last: { type: "boolean" },
  here: { type: "boolean" },
  cwd: { type: "string" },
  list: { type: "boolean" },
  json: { type: "boolean" },
  stdout: { type: "boolean" },
  output: { type: "string", short: "o" },
  format: { type: "string", default: "text" },
  "no-reasoning": { type: "boolean" },
  "user-only": { type: "boolean" },
  tools: { type: "boolean" },
  exact: { type: "boolean" },
  query: { type: "string", default: "" },
  "no-preview": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
}

class UsageError extends Error {
  name = "UsageError"
}

export async function runCli(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    stdin = process.stdin,
    cwd = process.cwd(),
    packageInfo: providedPackageInfo,
  } = {},
) {
  const packageInfo = normalizePackageInfo(
    providedPackageInfo ?? (await readPackageInfo()),
  )

  try {
    let values
    try {
      values = parseArgs({
        args: argv,
        options,
        strict: true,
        allowPositionals: false,
      }).values
    } catch (error) {
      throw new UsageError(
        error instanceof Error ? error.message : String(error),
      )
    }

    if (values.help) {
      stdout.write(helpText(packageInfo))
      return 0
    }

    if (values.version) {
      stdout.write(`${packageInfo.version}\n`)
      return 0
    }

    validate(values)
    return await run(values, { stdout, stderr, stdin, cwd })
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(
        `Error: ${error.message}\nRun ${packageInfo.command} --help for usage.\n`,
      )
      return 2
    }
    if (
      error instanceof Cancelled ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return 130
    }
    if (error?.code !== "EPIPE") {
      stderr.write(
        `Error: ${oneLine(error instanceof Error ? error.message : String(error))}\n`,
      )
    }
    return 1
  }
}

function validate(values) {
  if (!PICKERS.includes(values.picker)) {
    throw new UsageError("--picker must be auto, fzf, or inquirer")
  }
  if (values.provider !== undefined && !PROVIDERS.includes(values.provider)) {
    throw new UsageError("--provider must be codex, opencode, or t3code")
  }
  if (!FORMATS.includes(values.format)) {
    throw new UsageError("--format must be text, markdown, or json")
  }
  if (values.list) {
    const conflicts = [
      ["session", values.session !== undefined],
      ["last", values.last],
      ["stdout", values.stdout],
      ["output", values.output !== undefined],
      ["format", values.format !== "text"],
    ].filter(([, used]) => used)
    if (conflicts.length) {
      throw new UsageError(
        `--list cannot be combined with ${conflicts.map(([name]) => `--${name}`).join(", ")}`,
      )
    }
  }
  if (values.json && !values.list) {
    throw new UsageError("--json requires --list")
  }
  if (values.stdout && values.output !== undefined) {
    throw new UsageError("--stdout cannot be combined with --output")
  }
  if (values.output === "") throw new UsageError("--output needs a file path")
  if (values.here && values.cwd !== undefined) {
    throw new UsageError("--here cannot be combined with --cwd")
  }
  if (values.session !== undefined) {
    for (const name of ["last", "here", "cwd"]) {
      if (values[name] !== undefined) {
        throw new UsageError(`--session cannot be combined with --${name}`)
      }
    }
  }
  if (values["user-only"] && values.tools) {
    throw new UsageError("--user-only cannot be combined with --tools")
  }
}

// --here means the current project: the nearest directory containing .git,
// or the working directory itself outside a repository.
async function projectRoot(start) {
  for (let directory = start; ; directory = dirname(directory)) {
    try {
      await access(join(directory, ".git"))
      return directory
    } catch {
      if (dirname(directory) === directory) return start
    }
  }
}

// Chats may record either the literal or the symlink-resolved path.
async function directoryAliases(path) {
  const resolved = resolve(path)
  const real = await realpath(resolved).catch(() => resolved)
  return [...new Set([resolved, real])]
}

async function run(values, { stdout, stderr, stdin, cwd }) {
  const {
    copyClipboard,
    defaultCodexHome,
    defaultOpenCodeDb,
    defaultT3CodeDb,
    expandPath,
  } = await import("./system.js")
  const directories = values.here
    ? await directoryAliases(await projectRoot(resolve(cwd)))
    : values.cwd !== undefined
      ? await directoryAliases(expandPath(values.cwd, cwd))
      : undefined
  const pickChat = !values.list && !values.session && !values.last
  const readerOptions = {
    codexHome: values["codex-home"]
      ? expandPath(values["codex-home"], cwd)
      : defaultCodexHome(),
    openCodeDb: values.db ? expandPath(values.db, cwd) : defaultOpenCodeDb(),
    t3CodeDb: values["t3-db"]
      ? expandPath(values["t3-db"], cwd)
      : defaultT3CodeDb(),
    reasoning: !values["no-reasoning"],
    userOnly: !!values["user-only"],
    tools: !!values.tools,
    directories,
    format: values.format,
    preview: pickChat && !values["no-preview"],
  }
  let provider = values.provider
  const interactive = pickChat || (!provider && !values.last)
  if (interactive && !stdin.isTTY) {
    throw new ExportError(
      "Run the picker in a terminal, or use --last, --list, or --provider with --session ID",
    )
  }

  const native = await import("./pickers/native.js")
  const fzf =
    interactive && values.picker !== "inquirer"
      ? await native.nativeFzf()
      : undefined
  if (interactive && values.picker === "fzf" && !fzf) {
    throw new ExportError(
      "fzf 0.74+ was not found; use --picker inquirer or auto",
    )
  }
  if (!provider && !values.last) {
    provider = fzf
      ? await native.selectNativeSource(fzf)
      : await (await import("./pickers/fallback.js")).selectFallbackSource()
  }

  const { indexChats, runJob } = await import("./worker-client.js")

  if (values.list) {
    const rows = await runJob({
      mode: "list",
      provider,
      options: readerOptions,
    })
    if (!Array.isArray(rows)) throw new ExportError("Unexpected list response")
    if (values.json) stdout.write(JSON.stringify(rows, null, 2) + "\n")
    else {
      for (const row of rows) {
        stdout.write(`${row.id}\t${oneLine(row.title || row.directory)}\n`)
      }
    }
    return 0
  }

  const skipped = new Map()
  const onSkipped = (count, source = provider) => {
    skipped.set(source, (skipped.get(source) ?? 0) + count)
  }
  let id = values.session
  let selected
  if (values.last) {
    const latest = await latestChat(runJob, provider, readerOptions, onSkipped)
    provider = latest.provider
    id = latest.id
  } else if (pickChat) {
    const controller = new AbortController()
    const stop = () => controller.abort(new Cancelled())
    const iterator = indexChats(
      { mode: "index", provider, options: readerOptions },
      controller.signal,
      onSkipped,
    )
    try {
      if (fzf) {
        selected = await native.selectNativeChat(
          fzf,
          iterator,
          provider,
          !!values.exact,
          values.query,
          stop,
          { preview: readerOptions.preview },
        )
      } else {
        const { selectFallbackChat } = await import("./pickers/fallback.js")
        const loaded = (async () => {
          const entries = []
          for await (const entry of iterator) entries.push(entry)
          if (!entries.length) {
            throw new ExportError(noChatsMessage(directories))
          }
          return entries
        })()
        void loaded.catch(() => {})
        selected = await selectFallbackChat(
          loaded,
          provider,
          !!values.exact,
          values.query,
          stop,
        )
      }
    } finally {
      stop()
      await iterator.return(undefined)
    }
    id = selected.id
  }
  for (const [source, count] of skipped) {
    stderr.write(
      `Note: skipped ${count} ${providerName(source)} ${count === 1 ? "chat" : "chats"} stored in a format chat-export does not recognize yet.\n`,
    )
  }

  const result = await runJob({
    mode: "export",
    provider,
    options: readerOptions,
    id,
    ...(selected ? { selected } : {}),
  })
  if (Array.isArray(result)) throw new ExportError("Unexpected export response")

  const summary = `${result.parts} text parts from ${providerName(provider)}: ${result.display}`
  if (values.stdout) {
    await new Promise((resolve, reject) =>
      stdout.write(result.transcript, (error) =>
        error ? reject(error) : resolve(),
      ),
    )
  } else if (values.output !== undefined) {
    const path = expandPath(values.output, cwd)
    await writeFile(path, result.transcript, "utf8")
    stdout.write(`Wrote ${summary}\n  -> ${path}\n`)
  } else {
    await copyClipboard(result.transcript)
    stdout.write(`Copied ${summary}\n`)
  }
  return 0
}

function noChatsMessage(directories) {
  return directories
    ? `No main chats with visible text were found in ${directories[0]}`
    : "No main chats with visible text were found"
}

// Without --provider, --last compares all stores and skips a store that does
// not exist on this machine.
async function latestChat(runJob, provider, readerOptions, onSkipped) {
  const candidates = []
  let missing = 0
  for (const name of provider ? [provider] : PROVIDERS) {
    try {
      const latest = await runJob(
        { mode: "latest", provider: name, options: readerOptions },
        undefined,
        (count) => onSkipped(count, name),
      )
      if (latest) candidates.push(latest)
    } catch (error) {
      if (provider || !(error instanceof MissingStore)) throw error
      missing++
    }
  }
  if (missing === PROVIDERS.length) {
    throw new ExportError("No Codex, OpenCode, or T3 Code chat store was found")
  }
  if (!candidates.length) {
    throw new ExportError(noChatsMessage(readerOptions.directories))
  }
  return candidates.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
}

export async function readPackageInfo(
  packageJsonUrl = new URL("../package.json", import.meta.url),
) {
  const rawPackageJson = await readFile(packageJsonUrl, "utf8")
  return JSON.parse(rawPackageJson)
}

function normalizePackageInfo(packageInfo) {
  const command = Object.keys(packageInfo?.bin ?? {})[0]

  if (
    typeof packageInfo?.name !== "string" ||
    typeof packageInfo.version !== "string" ||
    !command
  ) {
    throw new Error(
      "package.json must define name, version, and one bin command",
    )
  }

  return {
    name: packageInfo.name,
    version: packageInfo.version,
    description:
      typeof packageInfo.description === "string"
        ? packageInfo.description
        : "",
    command,
  }
}

function helpText(packageInfo) {
  const { command, description, name, version } = packageInfo

  return `${name} ${version}
${description ? `\n${description}\n` : ""}
Usage:
  ${command} [options]

Choose Codex, OpenCode, or T3 Code, then a chat. fzf 0.74+ is preferred
when installed; otherwise Inquirer provides a searchable terminal picker.
Chat stores are
always read-only. No app startup or persistent text cache is used.

Choosing a chat:
  --provider codex|opencode|t3code
                              Skip the source picker.
  --picker auto|fzf|inquirer  Choose the picker (default: auto).
  --session ID                Export one main chat without its picker.
  --last                      Export the most recent chat without a picker;
                              without --provider, the newest of all sources.
  --here                      Only chats from the current project (the nearest
                              directory with .git, else the current directory).
  --cwd PATH                  Only chats started in PATH or below it.
  --list                      List main chat IDs; never touch the clipboard.
  --json                      JSON metadata with --list.
  --exact                     Literal search, including spaces and punctuation.
  --query TEXT                Initial chat search.
  --no-preview                Hide the chat preview in the picker.

Output:
  --stdout                    Print the chat instead of copying it.
  -o, --output FILE           Write the chat to FILE instead of copying it.
  --format text|markdown|json Export format (default: text).

Content:
  --no-reasoning              Omit reasoning from the export and search.
  --user-only                 Only your own messages.
  --tools                     Include tool calls and their output.

Stores:
  --codex-home PATH           Codex data directory (default: CODEX_HOME or ~/.codex).
  --db PATH                   OpenCode SQLite database (default: XDG data path).
  --t3-db PATH                T3 Code SQLite database (default: T3CODE_HOME or
                              ~/.t3, then userdata/state.sqlite).

  -h, --help                  Show this help text.
  -v, --version               Show the package version.

Codex preserves its dedupe, formatting, merge, and quoted-phrase search
behavior. OpenCode excludes children, synthetic/summary parts, and (unless
--tools) tool parts; attachments appear as labels. The selected chat is
reread before copying. T3 Code reads projected messages and saved plans,
with reasoning and tool activity controlled by the same content flags.
`
}
