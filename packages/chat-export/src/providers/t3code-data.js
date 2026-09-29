import { ExportError } from "../model.js"
import { validUnicode } from "../text.js"

export function t3Text(value, field) {
  if (typeof value !== "string")
    throw new ExportError(`Invalid T3 Code ${field}`)
  return validUnicode(value)
}

export function t3Timestamp(value) {
  const stamp = typeof value === "string" ? Date.parse(value) : NaN
  if (!Number.isFinite(stamp))
    throw new ExportError("Invalid T3 Code timestamp")
  return stamp
}

export function t3Json(value, field) {
  try {
    const parsed = JSON.parse(t3Text(value, field))
    const pending = [parsed]
    while (pending.length) {
      const item = pending.pop()
      if (typeof item === "string") validUnicode(item)
      else if (item !== null && typeof item === "object") {
        for (const [key, child] of Object.entries(item)) {
          validUnicode(key)
          pending.push(child)
        }
      }
    }
    return parsed
  } catch (cause) {
    throw new ExportError(
      `Invalid T3 Code ${field}; refusing a partial export`,
      { cause },
    )
  }
}
