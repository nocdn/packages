# quick-repo

A CLI to quickly create a new github repo

This wraps the official GitHub CLI (`gh`) so the repository is created using the
same account you have authenticated locally.

## Prerequisites

Install and authenticate GitHub CLI before running this package:

```bash
gh auth login
```

If GitHub CLI is missing or not authenticated, `quick-repo` exits with an error
that tells you to authenticate first.

## Install and run

Run without installing:

```bash
npx @nocdn/quick-repo
```

Or with npm:

```bash
npm exec @nocdn/quick-repo
```

## Usage

```bash
quick-repo [repo-name] [options]
```

You can answer the prompts interactively or pass values up front:

```bash
bunx @nocdn/quick-repo my-repo --private --description "My app" --init
```

When `repo-name` is omitted, the CLI defaults to the current folder name. Use
`owner/name` to create the repository under an organization you can access.

The CLI asks for:

- repository name, if not provided as an argument
- description
- `public` or `private` visibility

It creates a blank GitHub repository: no README, license, or `.gitignore` is
added remotely. After creation, it prints the commands to push your existing
local repository:

```bash
If you'd like to push an existing repository from the command line:

git remote add origin https://github.com/OWNER/REPO.git
git branch -M main
git push -u origin main
```

Use `--init` to make an initial local commit before the GitHub repository is
created:

```bash
npx @nocdn/quick-repo --init
```

That runs:

```bash
git init
git add .
git commit -m "init: initial file upload"
```

Use `--push` to add the new GitHub repository as `origin`, rename the local
branch to `main`, and push:

```bash
bunx @nocdn/quick-repo --init --push
```

That runs these commands after creating the GitHub repository:

```bash
git remote add origin https://github.com/OWNER/REPO.git
git branch -M main
git push -u origin main
```

`--push` needs an existing local commit. If you use `--push` without `--init`
and the current folder is not a git repository (or has no commits yet), it
exits with an error before creating anything on GitHub. Pair it with `--init`
to create the commit for you.

The push authenticates through GitHub CLI, so it works even when git has no
credential helper configured. Git is also run with `GIT_TERMINAL_PROMPT=0` so it
fails with a clear error instead of hanging on a credential prompt.

| argument | description |
| --- | --- |
| `repo-name` | optional repository name; defaults to the current folder name |

| flag | description |
| --- | --- |
| `-d`, `--description <text>` | use this repository description without prompting |
| `--public` | create a public repository without prompting |
| `--private` | create a private repository without prompting |
| `--init` | run `git init`, `git add .`, and `git commit -m "init: initial file upload"` before creating the GitHub repo |
| `--push` | add `origin`, rename the branch to `main`, and push after creating the GitHub repo |
| `-h`, `--help` | show help |
| `-v`, `--version` | show version |

## Logs

Every run writes a detailed JSON-lines log (arguments, each `gh`/`git` command
with its exit code, output, and duration, plus any error) so issues can be
debugged after the fact. When a run fails, the log path is printed in the error
output. The log lives at a platform-appropriate location:

| platform | path |
| --- | --- |
| macOS | `~/Library/Logs/quick-repo/quick-repo.log` |
| Windows | `%LOCALAPPDATA%\quick-repo\logs\quick-repo.log` |
| Linux | `$XDG_STATE_HOME/quick-repo/logs/quick-repo.log` (defaults to `~/.local/state/...`) |

Run `quick-repo --help` to print the exact path on your system. Logging is
best-effort: if the log file can't be written, the CLI still runs normally.

## Develop

```bash
npm install
npm start
```

The CLI entry point lives in [`bin/cli.js`](./bin/cli.js). The package is built
with plain Node.js and npm for maximum runtime compatibility.

## Publishing

This project includes a GitHub Actions workflow at
[`.github/workflows/publish.yml`](./.github/workflows/publish.yml) that publishes
the package to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers)
on every push, as long as the version in `package.json` is not already on npm.
`package.json` sets `publishConfig.access` to `public`, so the package is
published publicly by default.

To enable it once:

1. Push the repository to GitHub.
2. On npmjs.com, configure the package as a trusted publisher pointing at the
   `publish.yml` workflow in this repository.
3. Bump the version in `package.json` and push - the workflow will publish.
