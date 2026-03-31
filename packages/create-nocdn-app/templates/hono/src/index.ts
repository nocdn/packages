import { Hono } from "hono";

const defaultPort = Number.parseInt("{{port}}", 10);
const configuredPort = Number.parseInt(process.env.PORT ?? "", 10);
const port = Number.isNaN(configuredPort) ? defaultPort : configuredPort;

const app = new Hono();

app.get("/", (c) => {
  return c.json({
    name: "{{project-name}}",
    status: "ok",
    port,
  });
});

const server = Bun.serve({
  fetch: app.fetch,
  port,
});

console.log(`Listening on http://localhost:${server.port}`);
