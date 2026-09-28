# {{project-name}}

Requires Node.js 22.12 or newer.

To install dependencies:

```sh
bun install
```

To run the dev server:

```sh
bun run dev
```

To build for production:

```sh
bun run build
```

The production build includes a TypeScript check. You can also run it separately:

```sh
bun run typecheck
```

To run the production server after building:

```sh
bun run start
```

To lint or format the project:

```sh
bun run lint
bun run format
```

Shared base styles live in `src/globals.css`.
