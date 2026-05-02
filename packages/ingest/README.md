# repo-squeeze

Create an LLM-friendly digest of a local repository. It follows the same broad output shape as `gitingest`: a short
summary, a tree-like directory structure, and file contents separated by filename headers.

By default, `repo-squeeze` copies the digest to your clipboard with `clipboardy` instead of writing `digest.txt`.

## Usage

```bash
bunx repo-squeeze
bunx repo-squeeze .
bunx repo-squeeze /path/to/project
```

Write to a file instead:

```bash
bunx repo-squeeze -o output.txt
```

Use `-o` without a filename to write `digest.txt` in the directory where the command was run:

```bash
bunx repo-squeeze -o
```

Exclude files, directories, or glob-style patterns:

```bash
bunx repo-squeeze . --exclude "*.ts" ".next/" "coverage/"
```

Include only selected files:

```bash
bunx repo-squeeze . --include "src/**/*.ts" README.md
```

Apply the Next.js exclusion template:

```bash
bunx repo-squeeze . --template nextjs
bunx repo-squeeze . --exclude-template nextjs
```

List available templates:

```bash
bunx repo-squeeze --list-templates
```

Write the digest to stdout for piping:

```bash
bunx repo-squeeze --stdout | pbcopy
bunx repo-squeeze --stdout | llm
```

Print only the summary without copying or writing the digest:

```bash
bunx repo-squeeze --no-clipboard
```

Load additional ignore files alongside `.gitignore` and `.gitingestignore`:

```bash
bunx repo-squeeze --ignore-file .customignore
```

Include paths that are excluded by the built-in safety defaults, such as `node_modules` and `.git`:

```bash
bunx repo-squeeze . --include-dangerous
```

## CLI

```text
Usage:
  repo-squeeze [path] [options]

Options:
  -h, --help
  -v, --version
  -L, --list-templates
  -o, --output [file]
  -S, --stdout
  -n, --no-clipboard
  -i, --include <patterns...>
  -e, --exclude <patterns...>
  -T, --template <name>
  -d, --include-dangerous
  -g, --include-gitignored
  -F, --ignore-file <file>
  -s, --max-size <bytes>
```

Current templates: `bun`, `docs`, `go`, `hono`, `nextjs`, `node`, `python`, `react`, `rust`, and `vite`.

The package also exposes an `ingest` binary alias when installed.
