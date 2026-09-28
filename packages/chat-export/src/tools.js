// Tool activity is only read with --tools. Each tool record keeps structured
// fields for Markdown/JSON output, plus a plain `text` rendering that is used
// for the text transcript, search, dedupe, and refresh guards.

export function toolRecord({
  key,
  name,
  summary,
  input,
  output,
  lang,
  failed,
}) {
  const record = {
    kind: "tool",
    key,
    tool: {
      name,
      summary: summary ?? "",
      input: input ?? "",
      output: output ?? "",
      lang: lang ?? "",
      failed: !!failed,
    },
  }
  record.text = toolText(record.tool)
  return record
}

export function setToolOutput(record, output, failed) {
  record.tool.output = output ?? ""
  if (failed) record.tool.failed = true
  record.text = toolText(record.tool)
}

function toolText({ name, summary, input, output, failed }) {
  const lines = [
    `[Tool: ${name}]${summary ? ` ${summary}` : ""}${failed ? " (failed)" : ""}`,
  ]
  if (input) lines.push(input)
  if (output) lines.push("Output:", output)
  return lines.join("\n")
}

export function toolTitle({ name, summary, input }) {
  const detail = summary || input.replace(/\s*\n\s*/gu, " ").trim()
  const short = Array.from(detail)
  return `${name}${detail ? `: ${short.slice(0, 80).join("")}${short.length > 80 ? "…" : ""}` : ""}`
}

export function prettyJson(value) {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") {
    try {
      return prettyJson(JSON.parse(value))
    } catch {
      return value
    }
  }
  if (typeof value === "object" && !Object.keys(value).length) return ""
  return JSON.stringify(value, null, 2)
}
