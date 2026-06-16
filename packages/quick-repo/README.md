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

When `repo-name` is omitted, the CLI defaults to the current folder name. Use
`owner/name` to create the repository under an organization you can access.

The CLI asks for:

- repository name, if not provided as an argument
- description
- `public` or `private` visibility

It creates a blank GitHub repository: no README, license, or `.gitignore` is
added remotely. After creation, it prints GitHub-style setup commands:

```bash
Quick setup — if you've done this kind of thing before
  HTTPS: https://github.com/OWNER/REPO.git

…or create a new repository on the command line

echo "# REPO" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/OWNER/REPO.git
git push -u origin main

…or push an existing repository from the command line

git remote add origin https://github.com/OWNER/REPO.git
git branch -M main
git push -u origin main
```

| argument | description |
| --- | --- |
| `repo-name` | optional repository name; defaults to the current folder name |

| flag | description |
| --- | --- |
| `-h`, `--help` | show help |
| `-v`, `--version` | show version |

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
