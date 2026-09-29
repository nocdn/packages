import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";

export default defineConfig([
  {
    // Templates are scaffolded into other projects and linted there, and
    // record's vendor/ holds the built native helper.
    ignores: [
      "packages/create-nocdn-app/templates/",
      "packages/record/vendor/",
      "packages/record/native/",
      "coverage/",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // `const { omitted, ...rest } = value` is the idiomatic way to drop a key.
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    // Tests assert on raw ANSI escape sequences.
    files: ["packages/*/test/**", "packages/*/tests/**"],
    rules: {
      "no-control-regex": "off",
    },
  },
]);
