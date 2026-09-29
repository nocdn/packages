import { ExportError, object } from "../model.js"
import { prettyJson, toolRecord } from "../tools.js"
import { t3Json, t3Text, t3Timestamp } from "./t3code-data.js"

function renderTool(key, row, payload, data, at) {
  // Codex stores the original lifecycle notification in data.item. Claude
  // stores { toolName, input, result }; ACP uses rawInput/rawOutput/content.
  const item = object(data.item) ?? data
  const name =
    item.toolName ?? item.tool ?? payload.toolName ?? payload.itemType ?? "tool"
  const command = item.command ?? object(item.input)?.command
  const shell =
    payload.itemType === "command_execution" && typeof command === "string"
  const input = item.arguments ?? item.input ?? item.rawInput
  const output =
    item.aggregatedOutput ??
    item.result ??
    item.output ??
    item.rawOutput ??
    item.content ??
    item.error
  const status = payload.status ?? item.status
  const summary = [
    payload.title ?? row.summary,
    status && status !== "completed" ? `(${status})` : "",
    item.exitCode !== undefined && item.exitCode !== null
      ? `exit ${item.exitCode}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ")
  return {
    ...toolRecord({
      key,
      name: t3Text(name, "tool name"),
      summary,
      input: shell ? `$ ${command}` : prettyJson(input ?? item),
      output: prettyJson(output),
      lang: shell ? "sh" : "json",
      failed:
        status === "failed" ||
        status === "error" ||
        object(item.result)?.is_error === true ||
        (typeof item.exitCode === "number" && item.exitCode !== 0),
    }),
    at,
  }
}

export function t3Tools(rows) {
  const calls = new Map()
  for (const row of rows) {
    const payload = object(t3Json(row.payload_json, "tool payload"))
    if (!payload) throw new ExportError("Invalid T3 Code tool payload")
    // Tools inside a subagent belong to that agent's timeline.
    if (payload.agentId || payload.parentToolUseId) continue
    const data =
      object(payload.data) ??
      (payload.data == null ? {} : { value: payload.data })
    const callId =
      payload.toolCallId ?? data.toolCallId ?? object(data.item)?.id
    const key =
      callId === undefined
        ? `activity:${t3Text(row.activity_id, "activity ID")}`
        : JSON.stringify([row.turn_id, t3Text(callId, "tool call ID")])
    const previous = calls.get(key)
    const at = Math.min(previous?.at ?? Infinity, t3Timestamp(row.created_at))
    // Older rows can have no sequence and share timestamps. In particular,
    // shortened tool.updated payloads may sort after tool.completed. A full
    // terminal result must always win over progress snapshots.
    if (
      previous?.row.kind === "tool.completed" &&
      row.kind !== "tool.completed"
    ) {
      previous.at = at
      continue
    }
    // Updates are snapshots, not deltas. Keep the full terminal payload and
    // merge top-level fields omitted by later lifecycle notifications.
    const merged = { ...previous?.payload, ...payload }
    const mergedData = { ...previous?.data, ...data }
    calls.set(key, { row, payload: merged, data: mergedData, at })
  }
  return [...calls].map(([key, call]) =>
    renderTool(key, call.row, call.payload, call.data, call.at),
  )
}
