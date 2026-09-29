import process from "node:process"

import select from "@inquirer/select"

import { Cancelled } from "../model.js"
import { providerName, renderPreview } from "../render.js"
import { ChatMatcher } from "./matcher.js"
import { searchPrompt } from "./search-prompt.js"

const PREVIEW_LINES = 10

function previewLines(entry) {
  if (!entry.preview) return undefined
  const width = Math.max(20, (process.stderr.columns || 80) - 4)
  return renderPreview(entry.preview, {
    color: !process.env.NO_COLOR,
    width,
  })
    .split("\n")
    .slice(0, PREVIEW_LINES)
    .map((line) => `  ${line}`)
    .join("\n")
}

function escapeController() {
  const controller = new AbortController()
  const listener = (_, key) => {
    if (key?.name === "escape") controller.abort(new Cancelled())
  }
  process.stdin.on("keypress", listener)
  return {
    controller,
    cleanup: () => process.stdin.removeListener("keypress", listener),
  }
}

function cancelled(error, controller) {
  return (
    controller.signal.reason instanceof Cancelled ||
    (error instanceof Error &&
      ["ExitPromptError", "AbortPromptError"].includes(error.name))
  )
}

export async function selectFallbackSource() {
  const { controller, cleanup } = escapeController()
  try {
    return await select(
      {
        message: "Chat source",
        choices: [
          { name: "Codex", value: "codex" },
          { name: "OpenCode", value: "opencode" },
          { name: "T3 Code", value: "t3code" },
        ],
      },
      {
        output: process.stderr,
        signal: controller.signal,
        clearPromptOnDone: true,
      },
    )
  } catch (error) {
    if (cancelled(error, controller)) throw new Cancelled()
    throw error
  } finally {
    cleanup()
  }
}

export async function selectFallbackChat(
  entries,
  provider,
  exact,
  initialQuery,
  stop,
) {
  const matcher = entries.then(
    (items) => new ChatMatcher(items, provider, exact),
  )
  void matcher.catch(() => {})
  try {
    const selected = await searchPrompt(
      {
        message: `${providerName(provider)} conversation`,
        initialValue: initialQuery,
        preview: previewLines,
        source: async (query, signal) => {
          const ready = await matcher
          return signal.aborted ? [] : ready.find(query)
        },
      },
      { output: process.stderr, clearPromptOnDone: true },
    )
    if (!selected) throw new Cancelled()
    return selected
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      throw new Cancelled()
    }
    throw error
  } finally {
    stop()
  }
}
