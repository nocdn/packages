import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";

const defaultPort = Number.parseInt("{{port}}", 10);
const configuredPort = Number.parseInt(process.env.PORT ?? "", 10);
const port = Number.isNaN(configuredPort) ? defaultPort : configuredPort;

const mainWindowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "", 10) || 15 * 60 * 1000;
const mainLimit = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "", 10) || 100;
const healthWindowMs = Number.parseInt(process.env.HEALTH_RATE_LIMIT_WINDOW_MS ?? "", 10) || 500;
const healthLimit = Number.parseInt(process.env.HEALTH_RATE_LIMIT_MAX ?? "", 10) || 1;

const app = new Hono();

const mainLimiter = rateLimiter({
  windowMs: mainWindowMs,
  limit: mainLimit,
  keyGenerator: () => "global",
});

const healthLimiter = rateLimiter({
  windowMs: healthWindowMs,
  limit: healthLimit,
  keyGenerator: () => "global",
});

app.get("/api/health", healthLimiter, (c) => {
  return c.json({ status: "ok" });
});

app.use("*", mainLimiter);

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
