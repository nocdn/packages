import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Returns the directory where logs are stored, following each platform's
// conventional location:
//   - macOS:   ~/Library/Logs/quick-repo
//   - Windows: %LOCALAPPDATA%/quick-repo/logs
//   - Linux:   $XDG_STATE_HOME/quick-repo/logs (or ~/.local/state/...)
export function logDirectory() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Logs", "quick-repo");
  }

  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "quick-repo", "logs");
  }

  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "quick-repo", "logs");
}

// Creates a best-effort logger. Logging never throws: if the log file cannot be
// written, the logger silently disables itself so it can't break the CLI.
export async function createLogger(meta = {}) {
  const directory = logDirectory();
  const filePath = path.join(directory, "quick-repo.log");
  const runId = `${Date.now().toString(36)}-${process.pid}`;
  let enabled = true;

  try {
    await mkdir(directory, { recursive: true });
  } catch {
    enabled = false;
  }

  async function write(type, data) {
    if (!enabled) {
      return;
    }

    const entry = {
      time: new Date().toISOString(),
      runId,
      pid: process.pid,
      type,
      ...data,
    };

    try {
      await appendFile(filePath, `${JSON.stringify(entry)}\n`);
    } catch {
      enabled = false;
    }
  }

  await write("run.start", meta);

  return {
    filePath,
    runId,
    event(type, data = {}) {
      return write(type, data);
    },
    command(command, args, result) {
      return write("command", { command, args, ...result });
    },
    error(error) {
      return write("error", {
        message: error?.message ?? String(error),
        code: error?.code,
        stack: error?.stack,
      });
    },
  };
}
