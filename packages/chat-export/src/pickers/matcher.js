import { basicMatch, extendedMatch, Fzf } from "fzf"

import { encodeExact, quotedPhrase } from "../text.js"

export class ChatMatcher {
  cached

  constructor(entries, provider, exact) {
    this.entries = entries
    this.provider = provider
    this.exact = exact
  }

  find(raw) {
    let query = raw
    let scope = "all"
    let literal = this.exact
    let encoded = false
    if (this.provider === "codex" && !this.exact && raw.startsWith('"')) {
      scope = "transcript"
      const phrase = quotedPhrase(raw)
      if (phrase !== undefined) {
        query = phrase
        literal = true
      } else {
        query = encodeExact(raw.slice(1))
        encoded = true
      }
    }
    if (!query) return this.entries
    const key = `${scope}:${literal}:${encoded}`
    if (this.cached?.key !== key) {
      this.cached = {
        key,
        finder: new Fzf(this.entries, {
          selector: (entry) => {
            const value =
              scope === "all"
                ? `${entry.display}  ${entry.searchable}`
                : entry.searchable
            return encoded ? encodeExact(value) : value
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
