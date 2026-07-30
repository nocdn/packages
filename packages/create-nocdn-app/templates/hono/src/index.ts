import { app } from "./app";

const defaultPort = {{port}};

export function parsePort(value: string | undefined, fallback: number): number {
  const normalized = value?.trim();

  if (!normalized) {
    return fallback;
  }

  if (!/^\d+$/.test(normalized)) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const port = Number(normalized);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

export function startServer() {
  const port = parsePort(process.env.PORT, defaultPort);
  const server = Bun.serve({
    development: process.env.NODE_ENV !== "production",
    fetch: app.fetch,
    port,
  });

  let shuttingDown = false;

  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(
      JSON.stringify({ level: "info", message: "shutting down", signal }),
    );

    void server.stop().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  console.log(
    JSON.stringify({
      level: "info",
      message: "server listening",
      url: server.url.toString(),
    }),
  );

  return server;
}

if (import.meta.main) {
  startServer();
}
