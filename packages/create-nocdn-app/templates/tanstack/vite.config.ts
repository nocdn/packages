import { devtools } from "@tanstack/devtools-vite"
import { defineConfig } from "vite"
import tsconfigPaths from "vite-tsconfig-paths"

import { tanstackStart } from "@tanstack/react-start/plugin/vite"

import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"

const config = defineConfig({
  plugins: [
    devtools(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart(),
    viteReact({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
  ],
})

export default config
