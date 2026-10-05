// Helper run by native fzf on every query change. Usage: fzf-query.js
// search|literal QUERY. It drops Markdown syntax from the query and turns a
// double-quoted phrase into an exact search over the encoded transcript.
import process from "node:process"

import { fzfQuery } from "./text.js"

process.stdout.write(
  fzfQuery(process.argv[3] ?? "", process.argv[2] === "literal") + "\n",
)
