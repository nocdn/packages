import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import type { RequestIdVariables } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";

const projectName = "{{project-name}}";
const maxRequestBodySize = 1024 * 1024;

export function createApp() {
  const app = new Hono<{
    Variables: RequestIdVariables;
  }>();

  app.use("*", requestId({ limitLength: 128 }));
  app.use("*", secureHeaders());
  app.use("*", async (c, next) => {
    const startedAt = performance.now();

    await next();

    console.log(
      JSON.stringify({
        level: "info",
        message: "request completed",
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
      }),
    );
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: maxRequestBodySize,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "PAYLOAD_TOO_LARGE",
              message: "Request body exceeds the 1 MiB limit.",
            },
            requestId: c.get("requestId"),
          },
          413,
        ),
    }),
  );

  const routes = app
    .get("/api/health", (c) => {
      c.header("Cache-Control", "no-store");
      return c.json({ status: "ok" });
    })
    .get("/", (c) => {
      return c.text(
        [
          projectName,
          "=".repeat(projectName.length),
          "",
          "serves a hono api on the bun runtime",
          "",
          "",
          "",
          "ROUTES:",
          "",
          "Method | Path        | Description",
          "------ | ----------- | ---------------",
          "GET    | /           | usage reference",
          "GET    | /api/health | service status",
        ].join("\n") + "\n",
      );
    });

  routes.notFound((c) => {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Route not found.",
        },
        requestId: c.get("requestId"),
      },
      404,
    );
  });

  routes.onError((error, c) => {
    if (error instanceof HTTPException && error.status < 500) {
      return error.getResponse();
    }

    console.error(
      JSON.stringify({
        level: "error",
        message: "unhandled request error",
        requestId: c.get("requestId"),
        error: error.message,
        stack: error.stack,
      }),
    );

    return c.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred.",
        },
        requestId: c.get("requestId"),
      },
      500,
    );
  });

  return routes;
}

export const app = createApp();

export type AppType = typeof app;
