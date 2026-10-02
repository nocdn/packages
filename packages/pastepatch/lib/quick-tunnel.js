import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnCloudflaredProcess } from "./cloudflared-process.js";

/** Account-free tunnel. Its address belongs to this one cloudflared process. */
export async function startQuickTunnel({
  binary = "cloudflared",
  port,
  logger = async () => {},
  verbose = false,
  timeoutMs = 60_000,
  env = process.env,
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pastepatch-quick-"));
  const configFile = path.join(directory, "config.yml");
  try {
    // Explicit empty config keeps existing named-tunnel configuration intact.
    await writeFile(configFile, "{}\n", { mode: 0o600 });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith("TUNNEL_")) delete childEnv[key];
  }

  let resolveUrl;
  let rejectUrl;
  let foundUrl = false;
  let timer;
  const urlPromise = new Promise((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });
  const handle = spawnCloudflaredProcess({
    binary,
    args: [
      "tunnel",
      "--no-autoupdate",
      // Quick tunnels otherwise default to QUIC without TCP fallback.
      "--protocol",
      "auto",
      "--config",
      configFile,
      "--url",
      `http://127.0.0.1:${port}`,
      // Preserve loopback Host validation; never allow arbitrary public hosts.
      "--http-host-header",
      "localhost",
    ],
    env: childEnv,
    logger,
    label: "quick",
    verbose,
    onLine(line) {
      const match = line.match(
        /https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com)(?=[\s/"|]|$)/i,
      );
      if (match && !foundUrl) {
        foundUrl = true;
        clearTimeout(timer);
        resolveUrl(`https://${match[1].toLowerCase()}`);
      }
    },
  });
  timer = setTimeout(() => {
    rejectUrl(
      new Error(
        `Quick tunnel did not provide a URL within ${timeoutMs}ms. Try again, or use --setup-tunnel for a named tunnel.`,
      ),
    );
    handle.kill();
  }, timeoutMs);

  const finished = async (error) => {
    clearTimeout(timer);
    if (!foundUrl) {
      rejectUrl(
        new Error(
          "Quick tunnel ended before providing a URL. Check the cloudflared output and try again.",
          { cause: error },
        ),
      );
    }
    await rm(directory, { recursive: true, force: true });
  };
  // Attach rejection handlers immediately, including before URL discovery.
  const exitPromise = handle.exitPromise.then(
    async (result) => {
      await finished();
      return result;
    },
    async (error) => {
      await finished(error);
      throw error;
    },
  );
  // Callers may be waiting for urlPromise before watching exitPromise.
  void exitPromise.catch(() => {});
  return {
    child: handle.child,
    urlPromise,
    exitPromise,
    async kill() {
      handle.kill();
      const forceTimer = setTimeout(() => handle.child.kill("SIGKILL"), 2000);
      try {
        await exitPromise.catch(() => {});
      } finally {
        clearTimeout(forceTimer);
      }
    },
  };
}
