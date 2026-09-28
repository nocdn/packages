# {{project-name}}

A [Hono](https://hono.dev) API running on [Bun](https://bun.sh).

## Requirements

- [Bun](https://bun.sh) 1.3.14 or newer
- Docker with Compose (optional)

## Setup

```sh
bun install
cp .env.example .env
```

## Development

```sh
bun run dev
```

Open http://localhost:{{port}}

## Quality checks

```sh
bun run check
```

This runs ESLint, Prettier, TypeScript, and the Bun test suite. Run tests alone
with `bun test`.

## Routes

| Method | Path          | Description                    |
| ------ | ------------- | ------------------------------ |
| `GET`  | `/`           | Plain-text API usage explainer |
| `GET`  | `/api/health` | Health check                   |

## Environment variables

`PORT` is optional. The server exits at startup if it is not an integer between
1 and 65535. It controls the listening port and defaults to `{{port}}`.

## Production

Build a type-checked Bun bundle and run it:

```sh
bun run build
bun run start
```

The server handles `SIGINT` and `SIGTERM`, stops accepting new connections,
and waits for in-flight requests before exiting.

Commit `bun.lock`. The Docker build requires it and installs dependencies with
`--frozen-lockfile` for reproducible images. If the project was generated with
`--skip-install`, run `bun install` before building the image.

## API defaults

- Every response receives a validated `X-Request-Id` header.
- Hono's recommended secure response headers are enabled.
- Request bodies are limited to 1 MiB. Increase the `bodyLimit` setting when
  adding upload endpoints.
- Unknown routes and unexpected errors return JSON. Internal error details are
  logged, but never included in the `500` response.
- `/api/health` is not cached or rate-limited, so orchestrator probes remain
  reliable.
- CORS is disabled. Add Hono's CORS middleware with an explicit origin policy
  only when browser clients require it.

### Rate limiting

Rate limiting is intentionally deployment-specific. Configure it at a trusted
reverse proxy or API gateway, or use a shared store in the application. An
in-memory limiter is not globally consistent across replicas, and forwarded IP
headers must not be trusted unless the proxy path is controlled.

TLS termination, authentication, authorization, and readiness checks for
external dependencies are also application or platform concerns rather than
generic defaults.

## Docker

The multi-stage image pins Bun 1.3.14, builds the bundled server, and runs as
the unprivileged `bun` user. Compose includes a health check and a 30-second
graceful shutdown window.

```sh
docker compose up --build
```
