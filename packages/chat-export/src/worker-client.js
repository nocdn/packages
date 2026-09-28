import { URL } from "node:url"
import { Worker } from "node:worker_threads"

import { Cancelled, ExportError, MissingStore } from "./model.js"

// Runs a reader job in a worker thread and yields its messages. Index entries
// are acknowledged one at a time so the reader never gets far ahead of the
// picker, and aborting terminates the worker.
export async function* jobMessages(job, signal) {
  signal?.throwIfAborted()
  const worker = new Worker(new URL("./worker.js", import.meta.url), {
    workerData: job,
  })
  const queue = []
  let failure
  let ended = false
  let stopping
  let notify
  const wake = () => {
    notify?.()
    notify = undefined
  }
  const terminate = () =>
    stopping ?? (ended ? Promise.resolve(0) : (stopping = worker.terminate()))
  const abort = () => {
    failure = new Cancelled()
    wake()
    void terminate()
  }
  worker.on("message", (message) => {
    queue.push(message)
    wake()
  })
  worker.on("error", (error) => {
    failure = error
    wake()
  })
  worker.on("exit", (code) => {
    ended = true
    if (code !== 0 && !failure) {
      failure = new ExportError(`Reader stopped unexpectedly (${code})`)
    }
    wake()
  })
  signal?.addEventListener("abort", abort, { once: true })
  if (signal?.aborted) abort()
  try {
    while (true) {
      if (failure) throw failure
      const message = queue.shift()
      if (!message) {
        if (ended) {
          throw new ExportError("Reader ended before completing its request")
        }
        await new Promise((resolve) => {
          notify = resolve
        })
        continue
      }
      if (message.type === "error") {
        throw message.name === "MissingStore"
          ? new MissingStore(message.message)
          : new ExportError(message.message)
      }
      if (message.type === "done") return
      yield message
      if (message.type === "entry") worker.postMessage("next")
    }
  } finally {
    signal?.removeEventListener("abort", abort)
    await terminate()
  }
}

// `onSkipped(count)` reports chats the reader had to leave out.
export async function* indexChats(job, signal, onSkipped) {
  for await (const message of jobMessages(job, signal)) {
    if (message.type === "entry") yield message.entry
    else if (message.type === "skipped") onSkipped?.(message.count)
  }
}

export async function runJob(job, signal, onSkipped) {
  let result
  for await (const message of jobMessages(job, signal)) {
    if (message.type === "result") result = message.result
    else if (message.type === "skipped") onSkipped?.(message.count)
  }
  if (result === undefined) throw new ExportError("Reader produced no result")
  return result
}
