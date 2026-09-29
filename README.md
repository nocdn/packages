# packages

My npx-runnable CLIs, in one repository. Each directory in `packages/` is its
own npm package with its own version, and every one runs with `npx` or `bunx`.

| Package                                        | Run with                   | What it does                                                                |
| ---------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| [create-nocdn-app](packages/create-nocdn-app)  | `npx create-nocdn-app`     | Scaffold Next.js, Vite, TanStack Start, or Hono my preferred way            |
| [@nocdn/chat-export](packages/chat-export)     | `npx @nocdn/chat-export`   | Search and export a local Codex or OpenCode chat as text, Markdown, or JSON |
| [@nocdn/github-backup](packages/github-backup) | `npx @nocdn/github-backup` | Back up a whole GitHub personal profile                                     |
| [@nocdn/ingest](packages/ingest)               | `npx @nocdn/ingest`        | Ingest a local folder or repository into an LLM-friendly digest             |
| [@nocdn/pastepatch](packages/pastepatch)       | `npx @nocdn/pastepatch`    | Code with ChatGPT via clipboard tool plans or a remote MCP server           |
| [@nocdn/quick-repo](packages/quick-repo)       | `npx @nocdn/quick-repo`    | Quickly create a new GitHub repository                                      |
| [@nocdn/record](packages/record)               | `npx @nocdn/record`        | Record the Mac screen, system audio, and microphone from the command line   |

## Layout

```text
packages/<name>/        one npm package per directory (npm workspaces)
scripts/smoke.js        packs every package and runs it from a clean install
scripts/release-plan.js lists package versions that are not on npm yet
.github/workflows/
  checks.yml            lint, tests (Node 22 and 24, Linux and macOS), smoke test
  publish.yml           publishes changed packages with npm trusted publishing
  record.yml            builds, signs, notarizes and publishes @nocdn/record
  templates.yml         scaffolds and builds every create-nocdn-app template
```

## Development

Requires Node.js 22.13 or newer. The repository uses npm and a single root
`package-lock.json`.

```bash
npm install                                     # install every workspace
npm run lint                                    # ESLint and Prettier
npm test                                        # every package's tests
npm run smoke                                   # pack, install and run each CLI
npm run check                                   # all of the above
npm run format                                  # fix formatting and lint

npm test --workspace packages/quick-repo        # one package
npm start --workspace packages/quick-repo -- --help
npm install some-dep --workspace packages/ingest
```

## Releasing

Releases are driven by `version` in each package's `package.json`:

1. Bump the version, e.g.
   `npm version patch --workspace packages/ingest --no-git-tag-version`.
2. Merge or push the change to `main`.

On every push to `main`, [`publish.yml`](.github/workflows/publish.yml) runs
the checks, then publishes each package whose current version is not on npm
yet. A push without a version bump publishes nothing. Several packages can be
released in one push.

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers):
GitHub Actions proves its identity to npm with OIDC, so there is no npm token
in this repository, and every release gets a
[provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
linking it to the commit and workflow run that built it. On npmjs.com each
package trusts:

| Package             | Repository       | Workflow      |
| ------------------- | ---------------- | ------------- |
| `@nocdn/record`     | `nocdn/packages` | `record.yml`  |
| every other package | `nocdn/packages` | `publish.yml` |

Renaming either workflow file breaks publishing until the trusted publisher on
npmjs.com is updated to match.

`@nocdn/record` ships a signed and notarized macOS helper, so it is released by
[`record.yml`](.github/workflows/record.yml) on a macOS runner instead. It
needs the Apple signing secrets listed in
[its README](packages/record/README.md#publishing).

### Adding a new package

npm can only attach a trusted publisher to a package that already exists, so
the very first version of a new package is published by hand:

```bash
npm login
npm publish --workspace packages/<name> --access public
npm trust github @nocdn/<name> --repo nocdn/packages --file publish.yml
```

After that, releases go through `publish.yml` like every other package. See
[AGENTS.md](AGENTS.md) for how packages in this repository are put together.

## License

[MIT](LICENSE)
