import { spawn } from "node:child_process";
import process from "node:process";

/**
 * cloudflared is chatty (INF spam + "stream canceled by remote" on normal client disconnects).
 * Default: silence those lines. --verbose shows everything. Always log non-noise ERRs.
 */
export function isNoisyCloudflaredLine(line) {
  const text = String(line);
  if (/\bINF\b/.test(text)) {
    return true;
  }
  if (/stream \d+ canceled by remote/i.test(text)) {
    return true;
  }
  if (/Request failed error="stream \d+ canceled by remote/i.test(text)) {
    return true;
  }
  if (
    /CONNECTIVITY PRE-CHECKS|SUMMARY: Environment is healthy|precheck /i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /Generated Connector ID|Initial protocol|ICMP proxy|metrics server|Tunnel connection curve/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /Registered tunnel connection|Starting tunnel|Version |GOOS:|Settings: map|cloudflared will not automatically/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export function spawnCloudflaredProcess({
  binary,
  args,
  logger,
  label,
  verbose = false,
  env,
  onLine = () => {},
}) {
  const child = spawn(binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env,
  });

  let settled = false;
  let resolveExit;
  let rejectExit;
  const exitPromise = new Promise((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });

  const pending = { stdout: "", stderr: "" };
  const logLine = (streamName, rawLine) => {
    // Cloudflare errors include dest=https://host/mcp/<secret>. Redact before
    // truncation and before both quiet file logs and verbose terminal output.
    const line = rawLine
      .trimEnd()
      .replace(/\/mcp\/[A-Za-z0-9_-]+/g, "/mcp/<secret>");
    if (line) {
      onLine(line);
      if (!verbose && isNoisyCloudflaredLine(line)) {
        // Still keep a short trail in the pastepatch log file for debugging
        void logger(`cloudflared(${label}) quiet: ${line.slice(0, 200)}`);
        return;
      }
      process.stderr.write(`[cloudflared] ${line}\n`);
      void logger(`cloudflared(${label}) ${streamName}: ${line.slice(0, 500)}`);
    }
  };

  const onData = (streamName) => (chunk) => {
    // Buffer full lines: a secret split across pipe chunks must stay private.
    pending[streamName] += chunk;
    const lines = pending[streamName].split("\n");
    pending[streamName] = lines.pop();
    for (const line of lines) {
      logLine(streamName, line);
    }
  };

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", onData("stdout"));
  child.stderr?.on("data", onData("stderr"));

  child.on("error", (error) => {
    if (!settled) {
      settled = true;
      rejectExit(error);
    }
  });

  child.on("close", (code, signal) => {
    logLine("stdout", pending.stdout);
    logLine("stderr", pending.stderr);
    if (!settled) {
      settled = true;
      if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
        resolveExit({ code, signal });
      } else {
        rejectExit(
          new Error(
            `cloudflared exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"}). ` +
              "Check tunnel credentials, DNS route, and that the hostname matches the config.",
          ),
        );
      }
    }
  });

  return {
    child,
    exitPromise,
    kill() {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    },
  };
}
