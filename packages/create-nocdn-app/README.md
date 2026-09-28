# create-nocdn-app

To use:

```bash
bunx create-nocdn-app
```

or:

```bash
bunx create-nocdn-app my-app
```

This will ask you for a project name and let you scaffold either a Next.js (App Router) app, a Vite app, a TanStack Start app, a Bun + Hono API, or a Node.js CLI template with my preferred defaults.

For a CLI package under an npm organization, pass a scoped package name:

```bash
bunx create-nocdn-app @nocdn/package-name -t cli
```

The generated folder will be `package-name`, while the package published to npm will be `@nocdn/package-name`.
