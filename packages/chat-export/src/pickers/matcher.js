import { basicMatch, extendedMatch, Fzf } from "fzf"

import { encodeExact, plainText, quotedPhrase } from "../text.js"

// Mirrors the native fzf picker. Modes: `fuzzy` (default), `literal` (--exact,
// or a closed double-quoted phrase searched in the transcript), and `encoded`
// (an unclosed quote: fzf syntax over the transcript, apostrophes literal).
export class ChatMatcher {
  cached

  constructor(entries, exact) {
    this.entries = entries
    this.exact = exact
  }

  find(raw) {
    let mode = this.exact ? "literal" : "fuzzy"
    let transcriptOnly = false
    let query = plainText(raw)
    if (!this.exact && raw.startsWith('"')) {
      transcriptOnly = true
      const phrase = quotedPhrase(raw)
      if (phrase !== undefined) {
        mode = "literal"
        query = plainText(phrase)
      } else {
        mode = "encoded"
        query = encodeExact(plainText(raw.slice(1)))
      }
    }
    if (!query) return this.entries
    const key = `${mode}:${transcriptOnly}`
    if (this.cached?.key !== key) {
      const literal = mode === "literal"
      this.cached = {
        key,
        finder: new Fzf(this.entries, {
          selector: (entry) => {
            const value = plainText(
              transcriptOnly
                ? entry.searchable
                : `${entry.display}  ${entry.searchable}`,
            )
            return mode === "encoded" ? encodeExact(value) : value
          },
          // Linear matching avoids allocating a large dynamic-programming
          // matrix for multi-megabyte transcripts. No result or text length
          // is capped.
          fuzzy: literal ? false : "v1",
          match: literal ? basicMatch : extendedMatch,
          casing: "smart-case",
          normalize: !this.exact,
          limit: Infinity,
        }),
      }
    }
    return this.cached.finder.find(query).map((result) => result.item)
  }
}
