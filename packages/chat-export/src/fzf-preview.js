// Helper run by native fzf for the preview pane. The preview travels as a
// JSON field on each picker row, so this never reads the chat stores.
import process from "node:process"

import { renderPreview } from "./render.js"

try {
  const data = JSON.parse(process.argv[2] ?? "")
  process.stdout.write(renderPreview(data, { color: !process.env.NO_COLOR }))
} catch {
  process.stdout.write("(no preview)")
}
