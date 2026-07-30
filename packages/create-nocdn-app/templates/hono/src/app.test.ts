import { describe, expect, test } from "bun:test";

import { app, createApp } from "./app";
import { parsePort } from "./index";

describe("application", () => {
  test("serves the usage reference", async () => {
    const response = await app.request("/");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("text/plain");
    expect(body).toContain("GET    | /api/health | service status");
    expect(body.endsWith("\n")).toBe(true);
    expect(body.endsWith("\n\n")).toBe(false);
  });

  test("serves an unthrottled health check", async () => {
    for (let request = 0; request < 5; request += 1) {
      const response = await app.request("/api/health");

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ status: "ok" });
    }
  });

  test("sets security headers and a validated request ID", async () => {
    const response = await app.request("/api/health", {
      headers: { "X-Request-Id": "request_123" },
    });

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBe("request_123");

    const invalidIdResponse = await app.request("/api/health", {
      headers: { "X-Request-Id": "invalid request id" },
    });

    expect(invalidIdResponse.headers.get("x-request-id")).not.toBe(
      "invalid request id",
    );
  });

  test("returns JSON for missing routes", async () => {
    const response = await app.request("/missing");
    const body: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({
      error: { code: "NOT_FOUND", message: "Route not found." },
    });

    if (typeof body !== "object" || body === null || !("requestId" in body)) {
      throw new Error("Expected an error response with a requestId.");
    }

    expect(body.requestId).toBeString();
  });

  test("rejects oversized request bodies", async () => {
    const response = await app.request("/missing", {
      method: "POST",
      headers: { "Content-Length": String(1024 * 1024 + 1) },
      body: "too large",
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  test("does not expose unexpected errors", async () => {
    const errorApp = createApp().get("/__test-error", () => {
      throw new Error("sensitive internal detail");
    });

    const response = await errorApp.request("/__test-error");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("sensitive internal detail");
  });
});

describe("port configuration", () => {
  test("uses the fallback when PORT is absent or blank", () => {
    expect(parsePort(undefined, 3000)).toBe(3000);
    expect(parsePort("   ", 3000)).toBe(3000);
  });

  test("accepts a valid port", () => {
    expect(parsePort(" 8080 ", 3000)).toBe(8080);
  });

  test.each(["0", "-1", "65536", "3000abc", "1.5"])(
    "rejects invalid PORT=%s",
    (value) => {
      expect(() => parsePort(value, 3000)).toThrow(
        "PORT must be an integer between 1 and 65535.",
      );
    },
  );
});
