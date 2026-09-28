import js from "@eslint/js"
import { defineConfig } from "eslint/config"

export default defineConfig([
  {
    ignores: ["coverage/"],
  },
  js.configs.recommended,
])
