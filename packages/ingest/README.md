# repo-squeeze

`repo-squeeze` is a Bun CLI for turning a local repository or folder into a single text digest for LLM input. The output includes a summary, a tree-style directory view, and the contents of included files with path headers.

It is designed to feel similar to `gitingest` for local paths, with different defaults:

- default target is the current directory
- default output is the clipboard, not `digest.txt`
- local path ingestion only

## install and run

```bash
bunx repo-squeeze
```

The package also exposes an `ingest` binary alias when installed or linked.

## output behavior

Default behavior copies the full digest to the clipboard with `clipboardy`.

```bash
bunx repo-squeeze
```

Write to a file:

```bash
bunx repo-squeeze -o digest.txt
```

Use bare `-o` or `--output` to write `digest.txt` in the current working directory:

```bash
bunx repo-squeeze -o
```

Write the full digest to stdout:

```bash
bunx repo-squeeze --stdout
```

Print only the summary and do not copy or write the digest:

```bash
bunx repo-squeeze --no-clipboard
```

`--output`, `--stdout`, and `--no-clipboard` are mutually exclusive.

## usage

```bash
bunx repo-squeeze [path] [options]
```

Examples:

```bash
bunx repo-squeeze
bunx repo-squeeze .
bunx repo-squeeze /path/to/project
bunx repo-squeeze . --stdout | pbcopy
bunx repo-squeeze . --include "src/**/*.ts" README.md
bunx repo-squeeze . --exclude "*.log" coverage/ .next/
bunx repo-squeeze . --template nextjs
bunx repo-squeeze . --ignore-file .customignore
bunx repo-squeeze . --include-dangerous
bunx repo-squeeze --repo https://github.com/torvalds/linux.git
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
| `-r`, `--repo <url>` | clone a remote Git repo to a temp directory, run the squeeze, then clean up |

## matching and ignore rules

`repo-squeeze` supports glob-style include and exclude patterns such as `*.ts`, `src/**/*.ts`, and `.next/`.

By default it applies:

- built-in exclude patterns for common generated, dependency, cache, binary, and VCS paths
- patterns from `.gitignore`
- patterns from `.gitingestignore`

Add more ignore file names with `--ignore-file`:

```bash
bunx repo-squeeze . --ignore-file .customignore --ignore-file .dockerignore
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
bunx repo-squeeze --list-templates
```

Templates add exclusion patterns on top of the built-in defaults and any user-supplied excludes.

## output format

The digest contains:

- a summary with directory name, resolved path, analyzed file count, and excluded directories
- a tree-style directory structure
- file sections separated by headers in the form `FILE: relative/path`

This makes the output suitable for direct paste into an LLM or for piping into other tools.
