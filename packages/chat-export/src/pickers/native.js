import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { setTimeout, clearTimeout } from "node:timers"
import { fileURLToPath, URL } from "node:url"

import { PROVIDERS } from "../provider.js"
import { providerName } from "../render.js"

import { Cancelled, ExportError } from "../model.js"
import {
  command,
  findExecutable,
  fzfEnvironment,
  shellQuote,
} from "../system.js"
import { encodeExact, HIDDEN_PADDING, oneLine } from "../text.js"

const FZF_QUERY_HELPER = fileURLToPath(
  new URL("../fzf-query.js", import.meta.url),
)
const FZF_PREVIEW_HELPER = fileURLToPath(
  new URL("../fzf-preview.js", import.meta.url),
)

export async function nativeFzf() {
  let executable = await findExecutable("fzf")
  if (!executable) {
    const local = join(homedir(), ".local/bin/fzf")
    try {
      await access(local, constants.X_OK)
      executable = local
    } catch {
      return undefined
    }
  }
  const version = await command(
    executable,
    ["--version"],
    "",
    fzfEnvironment(),
  ).catch(() => undefined)
  const match = version?.stdout.match(/^(\d+)\.(\d+)/u)
  return version?.code === 0 &&
    match &&
    (Number(match[1]) > 0 || Number(match[2]) >= 74)
    ? executable
    : undefined
}

export async function selectNativeSource(executable) {
  const result = await command(
    executable,
    [
      "--no-multi",
      "--no-sort",
      "--layout=reverse",
      "--height=8",
      "--border",
      "--info=hidden",
      "--prompt=Chat source > ",
      "--header=Choose where to search. Enter opens; Esc cancels.",
    ],
    PROVIDERS.map(providerName).join("\n") + "\n",
    fzfEnvironment(),
  )
  if (result.code === 1 || result.code === 130) throw new Cancelled()
  if (result.code !== 0) {
    throw new ExportError(
      `fzf failed (${result.code}): ${oneLine(result.stderr)}`,
    )
  }
  const source = result.stdout.trim()
  const provider = PROVIDERS.find((name) => providerName(name) === source)
  if (!provider) {
    throw new ExportError("fzf returned an invalid source")
  }
  return provider
}

// Fields: visible display, padded searchable text, padded exact-encoded text,
// the row index fzf returns on accept, and (when previews are on) the preview
// as single-line JSON. The padding keeps the hidden fields off-screen.
export function nativeRow(entry, index) {
  const preview = entry.preview ? `\t${JSON.stringify(entry.preview)}` : ""
  return `${entry.display}\t${HIDDEN_PADDING}${entry.searchable}\t${HIDDEN_PADDING}${encodeExact(entry.searchable)}\t${index}${preview}\n`
}

export function nativeArgs(
  executable,
  provider,
  exact,
  query,
  preview = false,
) {
  const name = providerName(provider)
  const help =
    provider === "codex" && !exact
      ? "Wrap a phrase in double quotes for exact transcript search."
      : exact
        ? "Literal substring search; smart case."
        : "Fuzzy search; --exact enables literal phrases."
  const keys = `Enter selects; Esc cancels${preview ? "; Ctrl-/ toggles preview" : ""}.`
  const ready = `Full chat index loaded. ${keys} ${help}`
  const args = [
    executable,
    "--delimiter=\t",
    "--nth=1,2",
    "--accept-nth=4",
    "--no-hscroll",
    "--no-multi",
    "--layout=reverse",
    "--height=90%",
    "--border",
    "--info=inline",
    "--tiebreak=index",
    `--query=${query}`,
    `--prompt=${name} conversation > `,
    `--header=Indexing chats, newest first... ${help}`,
    `--bind=load:change-header(${ready})`,
    // Helpers below run through a POSIX shell regardless of the user's $SHELL.
    "--with-shell=/bin/sh -c",
  ]
  if (preview) {
    args.push(
      `--preview=${shellQuote(process.execPath)} ${shellQuote(FZF_PREVIEW_HELPER)} {5}`,
      "--preview-window=right,50%,wrap,<60(down,50%,wrap)",
      "--bind=ctrl-/:toggle-preview",
    )
  }
  if (exact) {
    args.push("--exact", "--no-extended", "--literal")
  } else if (provider === "codex") {
    const helper = `${shellQuote(process.execPath)} ${shellQuote(FZF_QUERY_HELPER)} {q}`
    const nth = `case "$FZF_QUERY" in '"'*) printf 3 ;; *) printf 1,2 ;; esac`
    args.push(
      `--bind=enter:wait+accept,start:trigger(change),change:transform-nth[${nth}]+transform-search:${helper}`,
    )
  }
  return args
}

export async function selectNativeChat(
  executable,
  entries,
  provider,
  exact,
  query,
  stop,
  { preview = false } = {},
) {
  const [program, ...args] = nativeArgs(
    executable,
    provider,
    exact,
    query,
    preview,
  )
  const child = spawn(program, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: fzfEnvironment(),
  })
  let stdout = ""
  let stderr = ""
  let spawnError
  let closed = false
  let finishedIndex = false
  const metadata = []
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk
  })
  child.on("error", (error) => {
    spawnError = error
    stop()
  })
  child.stdin.on("error", () => {})
  const done = new Promise((resolve) =>
    child.once("close", (code) => {
      closed = true
      stop()
      resolve(code ?? 130)
    }),
  )
  try {
    try {
      for await (const entry of entries) {
        if (closed) break
        const row = nativeRow(entry, metadata.length)
        metadata.push({ ...entry, searchable: "", preview: undefined })
        await new Promise((resolve, reject) =>
          child.stdin.write(row, "utf8", (error) =>
            error ? reject(error) : resolve(),
          ),
        )
      }
      finishedIndex = true
    } catch (error) {
      if (!closed && !(error instanceof Cancelled) && error.code !== "EPIPE") {
        throw error
      }
    } finally {
      child.stdin.end()
    }
    if (finishedIndex && !metadata.length && !closed) {
      throw new ExportError("No main chats with visible text were found")
    }
    const code = await done
    if (spawnError) throw spawnError
    if (code === 1 || code === 130) throw new Cancelled()
    if (code !== 0) {
      throw new ExportError(`fzf failed (${code}): ${oneLine(stderr)}`)
    }
    if (!/^\d+\s*$/u.test(stdout)) {
      throw new ExportError("fzf returned an invalid selection; nothing copied")
    }
    const selected = metadata[Number(stdout.trim())]
    if (!selected) {
      throw new ExportError("fzf returned an unknown selection; nothing copied")
    }
    return selected
  } finally {
    stop()
    if (!closed) {
      child.kill("SIGTERM")
      const kill = setTimeout(() => child.kill("SIGKILL"), 3000)
      kill.unref()
      await done
      clearTimeout(kill)
    }
  }
}
