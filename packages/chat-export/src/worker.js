import { parentPort, workerData } from "node:worker_threads"

import {
  conversations,
  countVisible,
  exportConversation,
  latestConversation,
  listConversations,
} from "./provider.js"
import { previewData, renderExport } from "./render.js"
import { indexEntry } from "./text.js"

// job.options carries the reader settings and the view: codexHome,
// openCodeDb, reasoning, tools, userOnly, directories, format, preview.
async function runWorker(job) {
  const port = parentPort
  if (!port) throw new Error("This module runs in a worker")
  const send = (message) => port.postMessage(message)
  const { options } = job
  let skipped = 0
  const onSkip = () => skipped++
  let acknowledge
  port.on("message", () => {
    const ready = acknowledge
    acknowledge = undefined
    ready?.()
  })
  if (job.mode === "index") {
    for await (const chat of conversations(job.provider, options, onSkip)) {
      if (!countVisible(chat, options)) continue
      const ready = new Promise((resolve) => {
        acknowledge = resolve
      })
      const entry = indexEntry(chat, options)
      if (options.preview) entry.preview = previewData(chat, options)
      send({ type: "entry", entry })
      await ready
    }
  } else if (job.mode === "list") {
    send({
      type: "result",
      result: await listConversations(job.provider, options),
    })
  } else if (job.mode === "latest") {
    send({
      type: "result",
      result: await latestConversation(job.provider, options, onSkip),
    })
  } else {
    const chat = await exportConversation(
      job.provider,
      job.id,
      options,
      job.selected,
    )
    const parts = countVisible(chat, options)
    if (!parts) {
      throw new Error("The selected chat has no visible text; nothing copied")
    }
    send({
      type: "result",
      result: {
        transcript: renderExport(chat, options.format, options),
        display: indexEntry(chat, options).display,
        parts,
      },
    })
  }
  if (skipped) send({ type: "skipped", count: skipped })
  send({ type: "done" })
  port.close()
}

runWorker(workerData).catch((error) => {
  parentPort?.postMessage({
    type: "error",
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  })
  parentPort?.close()
})
