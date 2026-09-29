export class ExportError extends Error {
  name = "ExportError"
}

// A chat store (Codex directory or a SQLite database) does not exist.
export class MissingStore extends ExportError {
  name = "MissingStore"
}

// A session uses a storage format this version cannot read in full.
export class UnsupportedFormat extends ExportError {
  name = "UnsupportedFormat"
}

export class Cancelled extends Error {
  name = "Cancelled"

  constructor() {
    super("Cancelled")
  }
}

export function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined
}

export function string(value) {
  return typeof value === "string" ? value : undefined
}
