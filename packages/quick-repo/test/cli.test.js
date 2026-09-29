import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const packageInfo = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

function run(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("--version prints the package version", () => {
  for (const flag of ["--version", "-v"]) {
    const result = run([flag]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `${packageInfo.version}\n`);
  }
});

test("--help prints usage without touching GitHub", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(
    result.stdout,
    new RegExp(packageInfo.version.replaceAll(".", "\\.")),
  );
  assert.equal(result.stderr, "");
});

test("unknown options are rejected", () => {
  const result = run(["--definitely-not-an-option"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown option "--definitely-not-an-option"/);
});
