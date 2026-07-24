import eslint from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

export default defineConfig([
  {
    ignores: ["dist/**", ".nitro/**", ".output/**", ".tanstack/**", "src/routeTree.gen.ts"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat["recommended-latest"],
    ],
  },
])
