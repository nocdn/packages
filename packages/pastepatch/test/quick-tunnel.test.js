import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { startQuickTunnel } from "../lib/quick-tunnel.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const cli = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const directories = [];
test.after(async () => {
  await Promise.all(
    directories.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(mode = "ready") {
  const root = await mkdtemp(path.join(os.tmpdir(), "pastepatch-quick-test-"));
  directories.push(root);
  const binary = path.join(root, "cloudflared");
  const record = path.join(root, "record.json");
  await writeFile(
    binary,
    `#!${process.execPath}
const fs = await import("node:fs/promises");
if (process.argv.includes("--version")) {
  console.log("cloudflared fixture");
} else {
  const args = process.argv.slice(2);
  const config = args[args.indexOf("--config") + 1];
  await fs.writeFile(${JSON.stringify(record)}, JSON.stringify({ args, config, configText: await fs.readFile(config, "utf8"), namedEnv: Object.keys(process.env).filter(key => key.startsWith("TUNNEL_")) }));
  const mode = ${JSON.stringify(mode)};
  if (mode === "exit") process.exitCode = 7;
  else {
    if (mode !== "hang") {
      process.stderr.write("INF https://wrong.trycloudflare.com.evil.example\\n");
      process.stderr.write("INF https://fixture-");
      setTimeout(() => process.stderr.write("temporary.trycloudflare.com\\n"), 20);
    }
    const timer = setInterval(() => {}, 1000);
    if (mode === "end") setTimeout(() => { clearInterval(timer); process.exitCode = 3; }, 200);
  }
}
`,
  );
  await chmod(binary, 0o755);
  return { root, binary, record };
}

test(
  "quick tunnel discovers a split URL, ignores lookalike hosts, and isolates config/env",
  { skip: process.platform === "win32" },
  async () => {
    const { binary, record } = await fixture();
    const handle = await startQuickTunnel({
      binary,
      port: 9876,
      env: {
        ...process.env,
        TUNNEL_NAME: "saved",
        TUNNEL_TOKEN: "fixture-token",
      },
    });
    try {
      assert.equal(
        await handle.urlPromise,
        "https://fixture-temporary.trycloudflare.com",
      );
      const captured = JSON.parse(await readFile(record, "utf8"));
      assert.equal(captured.configText, "{}\n");
      assert.deepEqual(captured.namedEnv, []);
      assert.ok(captured.args.includes("http://127.0.0.1:9876"));
      assert.ok(captured.args.includes("--http-host-header"));
      assert.ok(captured.args.includes("localhost"));
      assert.equal(
        captured.args[captured.args.indexOf("--protocol") + 1],
        "auto",
      );
      assert.ok(!captured.args.includes("run"));
      await handle.kill();
      await assert.rejects(readFile(captured.config), { code: "ENOENT" });
    } finally {
      await handle.kill();
    }
  },
);

test(
  "quick tunnel timeout and early exit reject URL discovery and clean up",
  { skip: process.platform === "win32" },
  async () => {
    for (const mode of ["hang", "exit"]) {
      const { binary, record } = await fixture(mode);
      const handle = await startQuickTunnel({
        binary,
        port: 9876,
        timeoutMs: 300,
      });
      await assert.rejects(handle.urlPromise, /did not provide|ended before/);
      await handle.kill();
      const captured = JSON.parse(await readFile(record, "utf8"));
      await assert.rejects(readFile(captured.config), { code: "ENOENT" });
    }
  },
);

test(
  "CLI quick mode works with no login, keeps saved configuration, serves JSON MCP, and stops",
  { skip: process.platform === "win32" },
  async () => {
    const { root, binary } = await fixture();
    const home = path.join(root, "home");
    await mkdir(path.join(home, ".pastepatch"), { recursive: true });
    const saved = path.join(home, ".pastepatch", "mcp-tunnel.json");
    await writeFile(
      saved,
      "fixture named configuration must not be read or changed\n",
    );
    const processInfo = await startCli(root, home, binary);
    const client = new Client({ name: "quick-cli-test", version: "1.0.0" });
    try {
      await waitFor(() =>
        processInfo.stdout.includes(
          "https://fixture-temporary.trycloudflare.com/mcp/",
        ),
      );
      const output = processInfo.stdout.trim();
      assert.match(
        output,
        /^https:\/\/fixture-temporary\.trycloudflare\.com\/mcp\/[A-Za-z0-9_-]{32,}$/,
      );
      const lock = JSON.parse(
        await readFile(path.join(home, ".pastepatch", "mcp.lock"), "utf8"),
      );
      const secret = (
        await readFile(path.join(home, ".pastepatch", "mcp-secret"), "utf8")
      ).trim();
      const url = new URL(`http://127.0.0.1:${lock.port}/mcp/${secret}`);
      await client.connect(new StreamableHTTPClientTransport(url));
      const wrote = await client.callTool({
        name: "create_file",
        arguments: { path: "from-mcp.txt", content: "quick session\n" },
      });
      assert.equal(wrote.isError, undefined);
      assert.equal(
        await readFile(path.join(root, "from-mcp.txt"), "utf8"),
        "quick session\n",
      );
      assert.equal(
        (await fetch(url, { headers: { Accept: "text/event-stream" } })).status,
        405,
      );
      assert.equal(
        (await fetch(`http://127.0.0.1:${lock.port}/mcp/wrong`)).status,
        404,
      );
      assert.deepEqual(
        await (await fetch(`http://127.0.0.1:${lock.port}/healthz`)).json(),
        { ok: true },
      );
      const invalidHostStatus = await new Promise((resolve, reject) => {
        const request = http.get(
          `http://127.0.0.1:${lock.port}/healthz`,
          {
            headers: { Host: "untrusted.example" },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        request.on("error", reject);
      });
      assert.equal(invalidHostStatus, 403);
      await client.callTool({ name: "stop_session", arguments: {} });
      assert.equal(await processInfo.exit, 0);
      assert.equal(
        await readFile(saved, "utf8"),
        "fixture named configuration must not be read or changed\n",
      );
      await assert.rejects(
        readFile(path.join(home, ".pastepatch", "mcp.lock")),
        { code: "ENOENT" },
      );
      const log = await readFile(path.join(root, ".pastepatch.log"), "utf8");
      assert.ok(!log.includes(secret));
    } finally {
      await client.close();
      processInfo.child.kill("SIGTERM");
      await processInfo.exit;
    }
  },
);

test(
  "CLI quick startup failure releases its lock and exits with a useful error",
  { skip: process.platform === "win32" },
  async () => {
    const { root, binary } = await fixture("exit");
    const home = path.join(root, "home");
    const info = await startCli(root, home, binary);
    try {
      assert.equal(await info.exit, 1);
      assert.match(info.stderr, /Quick tunnel ended before providing a URL/);
      await assert.rejects(
        readFile(path.join(home, ".pastepatch", "mcp.lock")),
        { code: "ENOENT" },
      );
    } finally {
      info.child.kill("SIGTERM");
    }
  },
);

test(
  "CLI can stop cleanly while waiting for a quick URL",
  { skip: process.platform === "win32" },
  async () => {
    const { root, binary, record } = await fixture("hang");
    const home = path.join(root, "home");
    const info = await startCli(root, home, binary);
    try {
      await waitFor(() => existsSync(record));
      info.child.kill("SIGTERM");
      assert.equal(await info.exit, 0);
      assert.equal(info.stdout, "");
      assert.doesNotMatch(info.stderr, /^Error:/m);
      await assert.rejects(
        readFile(path.join(home, ".pastepatch", "mcp.lock")),
        { code: "ENOENT" },
      );
      const captured = JSON.parse(await readFile(record, "utf8"));
      await assert.rejects(readFile(captured.config), { code: "ENOENT" });
    } finally {
      info.child.kill("SIGTERM");
    }
  },
);

test(
  "CLI quick tunnel ending stops MCP rather than silently changing the URL",
  { skip: process.platform === "win32" },
  async () => {
    const { root, binary } = await fixture("end");
    const home = path.join(root, "home");
    const info = await startCli(root, home, binary);
    assert.equal(await info.exit, 1);
    assert.match(info.stderr, /update the URL in ChatGPT/);
    assert.equal(info.stdout.trim().split("\n").length, 1);
    await assert.rejects(readFile(path.join(home, ".pastepatch", "mcp.lock")), {
      code: "ENOENT",
    });
  },
);

async function startCli(root, home, binary) {
  const net = await import("node:net");
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const child = spawn(
    process.execPath,
    [
      cli,
      "--quick-tunnel",
      "--path",
      root,
      "--port",
      String(port),
      "--no-auth",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        PASTEPATCH_CLOUDFLARED: binary,
        PASTEPATCH_TUNNEL_TOKEN: "ignored-fixture-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const info = { child, stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (data) => {
    info.stdout += data;
  });
  child.stderr.on("data", (data) => {
    info.stderr += data;
  });
  info.exit = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return info;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(
      Date.now() < deadline,
      "timed out waiting for quick tunnel startup",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
