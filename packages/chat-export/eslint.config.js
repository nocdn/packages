import js from "@eslint/js"
import { defineConfig } from "eslint/config"

export default defineConfig([
  {
    ignores: ["coverage/"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      // Web-compatible globals that Node provides without an import.
      globals: {
        AbortController: "readonly",
      },
    },
  },
])
