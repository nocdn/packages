# AGENTS.md

This repository holds all of nocdn's npx-runnable CLIs. Each directory in
`packages/` is a separate npm package with its own version, released from this
repository with npm trusted publishing. Read this file before adding or
changing a package; the root [README](README.md) covers releasing.

## Ground rules

- **npm only.** One root `package-lock.json`, npm workspaces (`packages/*`).
  Never add `bun.lock`, `pnpm-lock.yaml` or `yarn.lock`, and never add a
  per-package lockfile. The CLIs must still run under `npx` _and_ `bunx`.
- **Plain ESM JavaScript, no build step.** `"type": "module"`, `.js` files
  that Node runs as-is. What is in git is what is published (record's signed
  native helper is the one exception, see below).
- **Node >= 22.13.0.** Every package declares
  `"engines": { "node": ">=22.13.0" }`. CI tests on Node 22 and 24. Do not use
  APIs newer than 22.13 without raising `engines` (and the CI matrix)
  deliberately.
- **Minimal dependencies.** Reach for Node built-ins first (see the table
  below). Every dependency runs on users' machines through `npx`, so each one
  must be worth it. Dependencies with install scripts (`postinstall` etc.) are
  not allowed: CI installs with `--ignore-scripts`, and a CLI must not need a
  compile step on the user's machine.
- **Declare what you import.** Runtime dependencies go in the package's own
  `package.json`, never only in the root one. The root `package.json` holds
  shared dev tooling only. `npm run smoke` installs each packed tarball into an
  empty project and fails on anything undeclared.
- **Releasing is bumping `version`.** A push to `main` publishes every package
  whose version is not on npm yet. Only bump a version when you mean to release
  that package, and never publish from a local machine (except a brand new
  package's first version, see below).
- Run `npm run check` before you finish. It must pass.

## Creating a new CLI

Use `packages/quick-repo` or `packages/chat-export` as working references.
Names below use `<name>` for the directory and command, e.g. `quick-repo`.

### 1. Layout

```text
packages/<name>/
  package.json
  README.md
  LICENSE           copy of the root LICENSE (MIT)
  bin/cli.js        thin executable adapter
  src/cli.js        runCli(argv, io): all parsing and behaviour, testable
  src/*.js          the rest of the implementation
  test/cli.test.js  node:test tests
```

### 2. `package.json`

```json
{
  "name": "@nocdn/<name>",
  "version": "0.0.1",
  "description": "One sentence; shown in --help and on npm.",
  "license": "MIT",
  "keywords": ["cli", "nocdn"],
  "homepage": "https://github.com/nocdn/packages/tree/main/packages/<name>#readme",
  "bugs": {
    "url": "https://github.com/nocdn/packages/issues"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/nocdn/packages.git",
    "directory": "packages/<name>"
  },
  "type": "module",
  "engines": {
    "node": ">=22.13.0"
  },
  "bin": {
    "<name>": "bin/cli.js"
  },
  "files": ["bin", "src"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "start": "node ./bin/cli.js",
    "test": "node --test \"test/*.test.js\""
  }
}
```

Why each field matters:

- `name`: scoped `@nocdn/<name>`. `npx @nocdn/<name>` runs the bin whose name
  matches the unscoped part, so keep the bin name equal to `<name>` and keep a
  single bin.
- `repository.url` **must** be exactly `git+https://github.com/nocdn/packages.git`
  with `directory` set. npm rejects a provenance attestation whose repository
  does not match the repository that ran the workflow.
- `bin` path has no leading `./` (otherwise `npm publish` warns that it
  "auto-corrected" the bin entry), and
  `bin/cli.js` must start with `#!/usr/bin/env node`. Keep it executable
  (`chmod +x`, git records the mode).
- `files` is an allowlist. npm always adds `package.json`, `README.md` and
  `LICENSE`. Never ship tests, fixtures or local config.
- `test` quotes its glob so Node (not the shell) expands it, and only matches
  `test/*.test.js`, so fixtures and templates are never picked up as tests.
- No `prepublishOnly`/`prepack`/`postinstall` scripts: CI publishes with
  `--ignore-scripts`, so they would never run there anyway.

### 3. `bin/cli.js`: the adapter

```js
#!/usr/bin/env node
import process from "node:process";

import { runCli } from "../src/cli.js";

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}
```

Set `process.exitCode` instead of calling `process.exit()`, so pending output
is flushed before the process ends.

### 4. `src/cli.js`: argument parsing and behaviour

```js
import { readFile } from "node:fs/promises";
import process from "node:process";
import { parseArgs } from "node:util";

const options = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  output: { type: "string", short: "o" },
  force: { type: "boolean" },
};

export async function runCli(
  argv,
  { stdout = process.stdout, stderr = process.stderr, packageInfo } = {},
) {
  const pkg = packageInfo ?? (await readPackageInfo());
  const command = Object.keys(pkg.bin)[0];

  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options,
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    stderr.write(`Error: ${error.message}\nRun ${command} --help for usage.\n`);
    return 2;
  }

  if (values.help) {
    stdout.write(helpText(pkg, command));
    return 0;
  }
  if (values.version) {
    stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (positionals.length > 1) {
    stderr.write(
      `Error: expected at most one path.\nRun ${command} --help for usage.\n`,
    );
    return 2;
  }

  // ...do the work, writing results to stdout...
  return 0;
}

export async function readPackageInfo() {
  const url = new URL("../package.json", import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

function helpText(pkg, command) {
  return `${pkg.name} ${pkg.version}

${pkg.description}

Usage:
  ${command} [path] [options]

Options:
  -o, --output <file>  Write to a file instead of stdout
      --force          Overwrite an existing output file
  -h, --help           Show this help text
  -v, --version        Show the version
`;
}
```

Conventions every CLI follows:

- **Parse with `node:util` `parseArgs`, `strict: true`.** Unknown options and
  missing option values are errors. Validate positionals and option values
  yourself (count, enums, integer ranges) right after parsing.
- **`-h/--help` and `-v/--version` are mandatory.** Both exit 0. `--version`
  prints the version read from `package.json` at runtime (never a hard-coded
  string). `npm run smoke` runs both on the installed tarball and fails if the
  version is missing from the output.
- **Exit codes:** `0` success, `1` runtime failure, `2` usage error (bad
  flags or arguments). A usage error names the problem and points at
  `--help`.
- **stdout is for results, stderr is for everything else** (progress,
  prompts, warnings, errors), so `<name> ... | pbcopy` and `> file` work.
- **Colour** with `styleText` from `node:util`. It drops colour automatically
  when the stream is not a TTY and honours `NO_COLOR`/`FORCE_COLOR`; pass
  `{ stream: process.stderr }` when styling stderr output.
- **Interactive only on a TTY.** Prompt only when `process.stdin.isTTY` and
  `process.stdout.isTTY` are both true. Every prompt must have a flag
  equivalent so the CLI works in scripts, CI and from agents; without a TTY,
  fail with exit code 2 and say which flag is missing. Use `@clack/prompts`
  for prompts (already used by create-nocdn-app).
- **Never ask for confirmation of destructive actions only via a prompt:**
  refuse to overwrite files unless `--force` (or an equivalent) is given.
- **Child processes:** `execFile`/`spawn` from `node:child_process` with an
  argument array, never a shell string, so user input is never interpreted by
  a shell. Give long-running commands a `timeout`, and when a required tool
  (`git`, `gh`, `docker`, ...) is missing (`error.code === "ENOENT"`), say
  what to install. On Windows `npm`, `npx` and `code` are `.cmd` shims that
  need `shell: process.platform === "win32"`; only pass them arguments without
  spaces or shell metacharacters.
- **Paths and URLs:** build paths with `node:path`, turn `import.meta.url`
  into paths with `fileURLToPath`, and read bundled files relative to
  `import.meta.url`, never relative to `process.cwd()`.
- **Errors keep their cause:**
  `throw new Error("Could not read config", { cause: error })`.
- **No network or file access at import time.** Do the work inside `runCli`,
  so `--help` and `--version` are instant and offline.

### 5. Prefer these built-ins

| Need                     | Use                                              |
| ------------------------ | ------------------------------------------------ |
| Argument parsing         | `parseArgs` from `node:util`                     |
| Colours                  | `styleText` from `node:util`                     |
| HTTP                     | global `fetch` (with `AbortSignal.timeout()`)    |
| Tests and assertions     | `node:test`, `node:assert/strict`                |
| Temp dirs, copying trees | `fs.mkdtemp`, `fs.cp` from `node:fs/promises`    |
| Running commands         | `execFile`/`spawn` + `promisify`                 |
| Hashing, random tokens   | `node:crypto` (`randomBytes`, `timingSafeEqual`) |
| Line input from a stream | `node:readline/promises`                         |
| Env files                | `process.loadEnvFile()`                          |

Before adding a dependency, check that it is maintained, has no install
script, and is small. Pin with a caret range (`^1.2.3`); the lockfile pins
the exact version for CI and Dependabot keeps it current.

### 6. Tests

Test `runCli` directly with fake streams, and spawn the real executable once
or twice to prove the wiring works:

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../src/cli.js";

const packageInfo = {
  name: "@nocdn/example",
  version: "1.2.3",
  description: "An example CLI",
  bin: { example: "bin/cli.js" },
};

async function invoke(args) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(args, {
    packageInfo,
    stdout: { write: (chunk) => (stdout += chunk) },
    stderr: { write: (chunk) => (stderr += chunk) },
  });
  return { exitCode, stdout, stderr };
}

test("prints the version", async () => {
  assert.deepEqual(await invoke(["-v"]), {
    exitCode: 0,
    stdout: "1.2.3\n",
    stderr: "",
  });
});

test("rejects unknown options with exit code 2", async () => {
  const result = await invoke(["--nope"]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown option '--nope'/);
});

test("the executable runs", () => {
  const bin = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [bin, "--help"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});
```

Tests must not touch the network, the user's home directory or real
credentials. Use `fs.mkdtemp(path.join(os.tmpdir(), "..."))` for files and
inject anything external (clock, `fetch`, command runner, paths) through
parameters. Tests run on Linux and macOS; skip platform-specific tests with
`test("...", { skip: process.platform !== "darwin" }, ...)`.

### 7. README

Follow the existing READMEs: a one-line description, **Install and run**
(`npx @nocdn/<name>` and `bunx @nocdn/<name>`), **Usage** with a flags
table and examples, prerequisites (external tools, auth), then **Develop**
and **Publishing** sections pointing at the root README:

````md
## Develop

```bash
# from the repository root
npm install
npm test --workspace packages/<name>
npm start --workspace packages/<name> -- --help
```

## Publishing

This package lives in the [nocdn/packages](https://github.com/nocdn/packages)
monorepo. To release it, bump `version` in this `package.json` and push to
`main`. See the [repository README](../../README.md#releasing).
````

### 8. Wire it up and verify

1. From the repository root run `npm install`, which adds the workspace to
   `package-lock.json`. Commit the lockfile change.
2. Add the package to the table in the root [README](README.md).
3. Run `npm run check` (lint, all tests, smoke test).
   `npm run smoke <name>` smoke-tests just the new package.
4. Try it the way users will:
   `npm pack --workspace packages/<name>` then
   `npx --yes ./nocdn-<name>-0.0.1.tgz --help`. Delete the tarball
   afterwards.

### 9. First release (manual, once)

npm can only attach a trusted publisher to a package that already exists, so
the owner publishes the first version by hand and then hands releases to CI:

```bash
npm publish --workspace packages/<name> --access public
npm trust github @nocdn/<name> --repo nocdn/packages --file publish.yml
```

Both need the owner's npm login and 2FA; leave them to the owner rather than
running them yourself. After that, on npmjs.com under the package's
**Settings**, set publishing access to require 2FA and disallow tokens. From
then on a version bump pushed to `main` releases it.

`npm publish` needs a one-time password and `npm trust` needs a browser
approval for every command, so neither can run unattended. `npm trust` only
prompts when run in a real terminal; agents cannot approve it.

## Releasing a change

1. Bump the version of the package you changed. Use semver: a patch for fixes,
   a minor for features, a major for breaking changes (for a `0.x` package, a
   minor bump signals a breaking change):
   `npm version <patch|minor|major> --no-git-tag-version --workspace packages/<name>`
2. Run `npm install` so the root `package-lock.json` records the new version,
   then `npm run check`.
3. Commit the bump and push to `main`. `publish.yml` runs the checks, then
   `scripts/release-plan.js` lists every package whose version is not on npm
   yet and publishes each one. Check what it will publish beforehand with
   `node scripts/release-plan.js`; it should list only what you intend to
   release. `@nocdn/record` is excluded there and released by `record.yml`.
4. npm needs one to three minutes after a successful publish job before the
   version is visible. Verify with `npm view <package> dist-tags.latest` and
   `npm view <package>@<version> dist.attestations.provenance`, then run
   `npx --yes <package>@<version> --version` from an empty directory.

Code changes that do not bump a version are not released; users keep the
previous version until you bump it.

## Repository tooling

- **Lint and format:** one ESLint flat config (`eslint.config.js`) and one
  Prettier config at the root cover every package (Prettier defaults: 80
  columns, semicolons, double quotes). `npm run format` fixes both. Do not add
  per-package ESLint or Prettier configs; `packages/chat-export/.prettierrc.json`
  (no semicolons) is the one existing exception.
- **`scripts/smoke.js`:** packs every package, checks the tarball contains
  `README.md` and `LICENSE`, installs all tarballs into an empty project with
  dependencies from the registry (as `npx` does), and runs each bin with
  `--version` and `--help`. It skips packages whose `os` excludes the current
  platform.
- **`scripts/release-plan.js`:** lists packages whose version is not on npm.
  Only an npm 404 counts as "not published"; any other registry error fails
  the release rather than risking a bad publish.
- **Workflows:** `checks.yml` (every PR and branch push), `publish.yml` (push
  to `main`), `record.yml`, `templates.yml`. Actions are pinned to full commit
  SHAs with the version in a comment; keep that when updating them.
  Publishing jobs are the only jobs with `id-token: write`, and they install
  no dependencies and run no scripts. Keep it that way.
- **Dependabot** groups weekly updates with a 7 day cooldown for the root
  lockfile, the create-nocdn-app templates, and GitHub Actions.

## Package-specific notes

- **create-nocdn-app** copies templates bundled in the package (no network
  access and no `git clone` at runtime). The templates are standalone Bun
  projects with their own ESLint/Prettier/TypeScript configs; the root lint
  ignores `packages/create-nocdn-app/templates/`. npm never packs files named
  `.gitignore` or `.npmignore`, so templates store them as `gitignore` and
  `npmignore` and the scaffolder renames them. `templates.yml` scaffolds,
  installs, lints, typechecks, tests and builds every template. The Next.js
  template stays on ESLint 9 until `eslint-config-next`'s plugins support
  ESLint 10.
- **record** is macOS only and ships a Swift helper app in `vendor/` that is
  built, signed with a Developer ID certificate and notarized by `record.yml`
  on a macOS runner. `vendor/` is git-ignored. It is released by
  `record.yml`, not `publish.yml`. The platform is checked at runtime rather
  than with an `os` field in `package.json`: npm refuses to install a
  workspace whose `os`/`cpu` excludes the current machine, which would break
  `npm ci` on the Linux CI runners. Do the same for any platform-specific
  package.
- **github-backup** runs a Docker image pinned by tag _and_ digest
  (`DOCKER_IMAGE` in `bin/cli.js`). When updating it, change both and run
  `docker buildx imagetools inspect <image>:<tag>` to get the digest.
- **pastepatch** exposes a filesystem-writing MCP server through a public
  Cloudflare Tunnel. It is security-sensitive: the MCP endpoint lives at a
  secret path (`/mcp/<secret>`, secret in `~/.pastepatch/mcp-secret`), bearer
  tokens are compared in constant time and only accepted from the
  `Authorization` header, and `/healthz` reveals nothing. Do not weaken any of
  this, and never log the secret.
- **ingest** depends on `@llamaindex/liteparse` for PDF parsing, which is the
  largest install in the repository; keep new dependencies there to a minimum.
