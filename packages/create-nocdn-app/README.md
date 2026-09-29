# create-nocdn-app

To use:

```bash
bunx create-nocdn-app
```

or:

```bash
bunx create-nocdn-app my-app
```

This will ask you for a project name and let you scaffold either a Next.js (App Router) app, a Vite app, a TanStack Start app, or a Bun + Hono API with my preferred defaults.

Skip the prompts by passing a template and a name:

```bash
bunx create-nocdn-app my-app -t hono -p 8080 --agents minimal
```

Run `bunx create-nocdn-app --help` for every option.

The templates ship inside the package, so the project you get always matches the version of `create-nocdn-app` you ran, and scaffolding works offline.

## Develop

```bash
# from the repository root
npm install
npm test --workspace packages/create-nocdn-app
node packages/create-nocdn-app/index.js my-app -t hono --skip-install --skip-git
```

Each template in `templates/` is a standalone Bun project. The
[Templates workflow](../../.github/workflows/templates.yml) scaffolds, installs,
lints, typechecks, tests and builds every one of them.

## Publishing

This package lives in the [nocdn/packages](https://github.com/nocdn/packages)
monorepo. To release it, bump `version` in this `package.json` and push to
`main`. See the [repository README](../../README.md#releasing).
