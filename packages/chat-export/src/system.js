import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, isAbsolute, join, resolve } from "node:path"
import { Buffer } from "node:buffer"
import process from "node:process"

import { ExportError } from "./model.js"

export function expandPath(value, base = process.cwd()) {
  return resolve(
    base,
    value === "~"
      ? homedir()
      : value.startsWith("~/")
        ? join(homedir(), value.slice(2))
        : value,
  )
}

export function defaultCodexHome() {
  return expandPath(process.env.CODEX_HOME || "~/.codex")
}

export function defaultOpenCodeDb() {
  const root = process.env.XDG_DATA_HOME
  return join(
    root && isAbsolute(root) ? root : join(homedir(), ".local/share"),
    "opencode/opencode.db",
  )
}

export async function findExecutable(name) {
  for (const directory of (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)) {
    const candidate = join(directory, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next PATH entry.
    }
  }
  return undefined
}

// User fzf defaults could add bindings or commands that change what is
// selected, so the picker always runs with a clean fzf configuration.
export function fzfEnvironment() {
  const env = { ...process.env }
  for (const name of [
    "FZF_DEFAULT_OPTS",
    "FZF_DEFAULT_OPTS_FILE",
    "FZF_DEFAULT_COMMAND",
  ]) {
    delete env[name]
  }
  return env
}

export function shellQuote(value) {
  return `'${value.replace(/'/gu, `'"'"'`)}'`
}

export async function command(program, args, input = "", env = process.env) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(program, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let inputError
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") inputError = error
    })
    child.on("close", (code) =>
      inputError
        ? reject(inputError)
        : resolveResult({ code: code ?? 130, stdout, stderr }),
    )
    child.stdin.end(Buffer.from(input, "utf8"))
  })
}

export async function copyClipboard(text) {
  const candidates =
    process.platform === "darwin"
      ? [["pbcopy", []]]
      : process.platform === "linux"
        ? [
            ["wl-copy", []],
            ["xclip", ["-selection", "clipboard", "-in"]],
            ["xsel", ["--clipboard", "--input"]],
          ]
        : []
  for (const [name, args] of candidates) {
    const executable = await findExecutable(name)
    if (!executable) continue
    const result = await command(executable, args, text, {
      ...process.env,
      LC_ALL: "en_US.UTF-8",
    })
    if (result.code !== 0) {
      throw new ExportError(`${name} failed (${result.code}); try --stdout`)
    }
    return
  }
  throw new ExportError(
    "No clipboard helper is available. Use --stdout to export the chat.",
  )
}
