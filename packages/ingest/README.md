# @nocdn/ingest

`@nocdn/ingest` is a Bun CLI for turning a local repository or folder into a single text digest for LLM input. The output includes a summary, a tree-style directory view, and the contents of included files with path headers.

It is designed to feel similar to `gitingest` for local paths, with different defaults:

- default target is the current directory
- default output is the clipboard, not `digest.txt`
- local path ingestion only

## install and run

```bash
bunx @nocdn/ingest
```

When installed globally or linked, the package exposes an `ingest` binary.

## output behavior

Default behavior copies the full digest to the clipboard with `tinyclip`.

```bash
bunx @nocdn/ingest
```

Write to a file:

```bash
bunx @nocdn/ingest -o digest.txt
```

Use bare `-o` or `--output` to write `digest.txt` in the current working directory:

```bash
bunx @nocdn/ingest -o
```

Write the full digest to stdout:

```bash
bunx @nocdn/ingest --stdout
```

Print only the summary and do not copy or write the digest:

```bash
bunx @nocdn/ingest --no-clipboard
```

`--output`, `--stdout`, and `--no-clipboard` are mutually exclusive.

## usage

```bash
bunx @nocdn/ingest [path] [options]
```

Examples:

```bash
bunx @nocdn/ingest
bunx @nocdn/ingest .
bunx @nocdn/ingest /path/to/project
bunx @nocdn/ingest . --stdout | pbcopy
bunx @nocdn/ingest . --include "src/**/*.ts" README.md
bunx @nocdn/ingest . --exclude "*.log" coverage/ .next/
bunx @nocdn/ingest . --template nextjs
bunx @nocdn/ingest . --ignore-file .customignore
bunx @nocdn/ingest . --all
bunx @nocdn/ingest . --all --exclude-gitignored --exclude-env
bunx @nocdn/ingest . --include-dangerous
bunx @nocdn/ingest --repo https://github.com/torvalds/linux.git
```

## options

| flag | description |
| --- | --- |
| `-h`, `--help` | show help |
| `-v`, `--version` | show version |
| `-L`, `--list-templates` | list available templates |
| `-o`, `--output [file]` | write digest to a file; without a file, writes `digest.txt` |
| `-S`, `--stdout` | write the full digest to stdout |
| `-n`, `--no-clipboard` | skip digest output side effects and print only the summary |
| `-a`, `--all` | enable every special include option: `--include-dangerous`, `--include-gitignored`, `--include-pdf`, `--include-env`, and `--ipynb` |
| `--exclude-dangerous` | with `--all`, keep built-in safety defaults excluded |
| `--exclude-gitignored` | with `--all`, keep `.gitignore` and `.gitingestignore` filtering enabled |
| `--exclude-pdf` | with `--all`, keep PDF files excluded |
| `--exclude-env` | with `--all`, keep `.env` files excluded |
| `--exclude-ipynb` | with `--all`, keep `.ipynb` files as raw JSON instead of converting them |
| `-i`, `--include <patterns...>` | include only matching files; directories are still traversed |
| `-e`, `--exclude <patterns...>` | exclude files or directories |
| `-T`, `--template <name>` | apply an exclusion template |
| `--exclude-template <name>` | alias for `--template` |
| `-d`, `--include-dangerous` | include paths that are excluded by built-in defaults such as `node_modules` and `.git` |
| `-g`, `--include-gitignored` | ignore `.gitignore` and `.gitingestignore` filtering |
| `-F`, `--ignore-file <file>` | also load ignore patterns from an additional ignore file name |
| `-s`, `--max-size <bytes>` | maximum size of a single included file; default `10485760` |
| `-N`, `--line-numbers` | prefix each line of file content with its line number |
| `--include-env` | include `.env` files that are excluded by built-in defaults and templates |
| `--dry-run` | preview the files that would be included with sizes, without producing a digest |
| `--ipynb` | convert `.ipynb` files to a readable text format (cell sources and outputs) instead of raw JSON |
| `-r`, `--repo <url>` | clone a remote Git repo to a temp directory, ingest it, then clean up |

## matching and ignore rules

`@nocdn/ingest` supports glob-style include and exclude patterns such as `*.ts`, `src/**/*.ts`, and `.next/`.

By default it applies:

- built-in exclude patterns for common generated, dependency, cache, binary, and VCS paths, including `.firecrawl/`
- patterns from `.gitignore`
- patterns from `.gitingestignore`

Add more ignore file names with `--ignore-file`:

```bash
bunx @nocdn/ingest . --ignore-file .customignore --ignore-file .dockerignore
```

Use `--include-gitignored` to skip loading ignore-file patterns entirely.

## templates

Current templates:

- `bun`
- `docs`
- `go`
- `hono`
- `nextjs`
- `node`
- `python`
- `react`
- `rust`
- `typescript`
- `vite`

Inspect the available templates from the CLI:

```bash
bunx @nocdn/ingest --list-templates
```

Templates add exclusion patterns on top of the built-in defaults and any user-supplied excludes.

## output format

The digest contains:

- a summary with directory name, resolved path, analyzed file count, word/line stats, and excluded directories
- a tree-style directory structure
- file sections separated by headers in the form `FILE: relative/path`

This makes the output suitable for direct paste into an LLM or for piping into other tools.
