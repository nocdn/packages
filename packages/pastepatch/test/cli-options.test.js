import assert from "node:assert/strict";
import test from "node:test";
import { parseCliArgs } from "../lib/cli-options.js";

const parse = (args, env = {}) => parseCliArgs(args, { env });

test("quick-tunnel is an explicit account-free MCP mode", () => {
  const args = parse(["--quick-tunnel", "project", "--port=9000"]);
  assert.equal(args.mcp, true);
  assert.equal(args.quickTunnel, true);
  assert.equal(args.path, "project");
  assert.equal(args.port, 9000);
  assert.equal(parse(["--mcp"]).quickTunnel, false);
});

test("quick-tunnel refuses conflicting explicit tunnel options", () => {
  for (const other of [
    ["--no-tunnel"],
    ["--setup-tunnel"],
    ["--hostname", "mcp.example.com"],
    ["--tunnel-name", "named"],
    ["--tunnel-token", "token"],
    ["--init"],
  ]) {
    assert.throws(
      () => parse(["--quick-tunnel", ...other]),
      /--help for usage/,
    );
  }
  // Existing named-tunnel env does not prevent choosing the quick workflow.
  assert.equal(
    parse(["--quick-tunnel"], { PASTEPATCH_TUNNEL_TOKEN: "named-token" })
      .quickTunnel,
    true,
  );
});

test("argument parsing rejects unknown flags, missing values, bad ports and extra paths", () => {
  for (const args of [
    ["--nope"],
    ["--port"],
    ["--port", "0"],
    ["--port", "1.5"],
    ["--port", "65536"],
    ["first", "second"],
  ]) {
    assert.throws(() => parse(args), /--help for usage/);
  }
  assert.throws(() => parse([], { PASTEPATCH_MCP_PORT: "invalid" }), /integer/);
  assert.equal(
    parse(["--help"], { PASTEPATCH_MCP_PORT: "invalid" }).help,
    true,
  );
  assert.equal(
    parse(["--version"], { PASTEPATCH_MCP_PORT: "invalid" }).version,
    true,
  );
});

test("existing aliases, repeated patterns, overrides and ingest arguments are preserved", () => {
  const args = parse([
    "--init",
    "-m",
    "first",
    "--task",
    "last",
    "-i",
    "*.js",
    "--include",
    "*.md",
    "-e",
    "vendor",
    "--color",
    "--no-color",
    "--",
    "--line-numbers",
  ]);
  assert.equal(args.task, "last");
  assert.deepEqual(args.include, ["*.js", "*.md"]);
  assert.deepEqual(args.exclude, ["vendor"]);
  assert.deepEqual(args.ingestArgs, ["--line-numbers"]);
  assert.equal(args.color, false);
  assert.equal(parse(["--setup-tunnel"]).mcp, true);
  assert.equal(parse(["--last-log"]).log, true);
  assert.equal(
    parse(["--port", "9876"], { PASTEPATCH_MCP_PORT: "1234" }).port,
    9876,
  );
});
