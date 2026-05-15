# github-backup

A CLI to backup a whole github personal profile

## Install and run

Run without installing:

```bash
npx github-backup
```

Or with bun, pnpm, or yarn:

```bash
bunx github-backup
pnpm dlx github-backup
yarn dlx github-backup
```

## Usage

```bash
github-backup [options]
```

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
with plain Node.js and npm for maximum runtime compatibility, but the published
binary can be invoked with any package runner (`npx`, `bunx`, `pnpm dlx`, ...).

## Publishing

This project includes a GitHub Actions workflow at
[`.github/workflows/publish.yml`](./.github/workflows/publish.yml) that publishes
the package to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers)
on every push, as long as the version in `package.json` is not already on npm.

To enable it once:

1. Push the repository to GitHub.
2. On npmjs.com, configure the package as a trusted publisher pointing at the
   `publish.yml` workflow in this repository.
3. Bump the version in `package.json` and push - the workflow will publish.
