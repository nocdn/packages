import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { pastepatchConfigDir } from "./tunnel.js";

/**
 * The MCP endpoint is served at /mcp/<secret> so that knowing the public
 * hostname is not enough to reach the write and run_command tools. ChatGPT's
 * "No authentication" connector mode sends no credentials, so an unguessable
 * URL is the protection that works with it.
 *
 * The secret is stored in ~/.pastepatch/mcp-secret (mode 0600) and reused on
 * every start, so the connector URL stays the same until it is rotated.
 */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

export function mcpSecretPath() {
  return path.join(pastepatchConfigDir(), "mcp-secret");
}

export function generateMcpSecret() {
  return randomBytes(24).toString("base64url");
}

export function mcpPathForSecret(secret) {
  return `/mcp/${secret}`;
}

export async function loadOrCreateMcpSecret({
  rotate = false,
  secretPath = mcpSecretPath(),
} = {}) {
  if (!rotate) {
    try {
      const existing = (await readFile(secretPath, "utf8")).trim();
      if (SECRET_PATTERN.test(existing)) {
        return { secret: existing, created: false };
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  const secret = generateMcpSecret();
  await mkdir(path.dirname(secretPath), { recursive: true, mode: 0o700 });
  await writeFile(secretPath, `${secret}\n`, { mode: 0o600 });
  // writeFile's mode only applies when the file is created.
  await chmod(secretPath, 0o600);
  return { secret, created: true };
}

/** Constant-time string comparison for bearer tokens. */
export function safeTokenEqual(provided, expected) {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}
