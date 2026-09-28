// Helper run by native fzf on every Codex query change. It translates a
// double-quoted phrase into an exact fzf search over the encoded transcript.
import process from "node:process"

import { fzfQuery } from "./text.js"

process.stdout.write(fzfQuery(process.argv[2] ?? "") + "\n")
