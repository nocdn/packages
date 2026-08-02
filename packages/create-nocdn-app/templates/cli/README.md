# {{project-name}}

<!-- prettier-ignore -->
{{project-description}}

## Requirements

- Node.js 22.13 or newer

## Install and run

Run the package without installing it globally:

```bash
npx {{package-name}} --help
```

Or install it globally and use its executable:

```bash
npm install --global {{package-name}}
{{project-name}} --help
```

The published package has no runtime dependencies. Other package runners such
as `bunx`, `pnpm dlx`, and `yarn dlx` can run the same package when needed.

## Usage

```text
{{project-name}} [options]
```

| Option            | Description               |
| ----------------- | ------------------------- |
| `-h`, `--help`    | Show help.                |
| `-v`, `--version` | Show the package version. |

Unknown options and positional arguments are rejected with a non-zero exit
status. Help, version, and normal execution write to stdout; usage errors write
to stderr.

## Develop

Install the exact development dependency tree and commit the generated
`package-lock.json` so local development and CI resolve the same packages:

```bash
npm install
npm start -- --help
```

The executable adapter lives in [`bin/cli.js`](./bin/cli.js), and the testable
implementation lives in [`src/cli.js`](./src/cli.js). The project uses plain
ESM JavaScript and Node built-ins, so publishing does not require a build step.

Available checks:

```bash
npm test
npm run lint
npm run check
npm run format
npm pack --dry-run
```

Tests use Node's built-in test runner. CI runs the checks on every currently
supported Node.js release line and inspects the package tarball contents.

## Publishing

The workflow at
[`.github/workflows/publish.yml`](./.github/workflows/publish.yml) uses npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers) and
[staged publishing](https://docs.npmjs.com/staged-publishing). It has no npm
token and installs no project dependencies in the job that receives the OIDC
publishing permission.

Set it up once:

1. Add a full `repository` object to `package.json`. Its URL must exactly match
   the public GitHub repository URL.
2. Publish the first version manually with `npm publish --access public`.
   npm cannot use trusted or staged publishing for a brand-new package.
3. In the package settings on npmjs.com, add a GitHub Actions trusted publisher
   for this repository and the workflow filename `publish.yml`. Allow
   **`npm stage publish` only**.
4. Require 2FA and disallow token-based publishing in the package settings.
5. Bump `package.json` and create a matching tag, such as `v1.2.3` for version
   `1.2.3`, then push the tag.
6. Review the staged package on npmjs.com and approve it with 2FA.

The tag/version check prevents publishing the wrong manifest version. Public
packages published from public repositories receive npm provenance
automatically through trusted publishing.
