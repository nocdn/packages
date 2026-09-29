import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../index.js", import.meta.url));
const packageInfo = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const tempDirectories = [];

test.after(async () => {
  await Promise.all(
    tempDirectories.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function run(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
}

async function scaffold(template, extraArgs = []) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "create-nocdn-app-"));
  tempDirectories.push(cwd);
  const result = run(
    [
      "my-app",
      "-t",
      template,
      "--skip-install",
      "--skip-git",
      "--agents",
      "none",
      ...extraArgs,
    ],
    cwd,
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return path.join(cwd, "my-app");
}

async function listFiles(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(dir, entry.name), relative)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

test("--version prints the package version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `create-nocdn-app v${packageInfo.version}\n`);
});

test("--help lists the templates", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /next \| vite \| tanstack \(or start\) \| hono/);
});

test("unknown options and invalid values are rejected", () => {
  const unknown = run(["my-app", "--definitely-not-an-option"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown option '--definitely-not-an-option'/);

  const template = run(["my-app", "-t", "cli"]);
  assert.equal(template.status, 1);
  assert.match(template.stderr, /invalid template "cli"/);

  const port = run(["my-app", "-t", "hono", "-p", "99999"]);
  assert.equal(port.status, 1);
  assert.match(port.stderr, /Port must be between 1 and 65535/);
});

for (const template of ["next", "vite", "tanstack", "hono"]) {
  test(`scaffolds the ${template} template from the bundled files`, async () => {
    const projectPath = await scaffold(template, ["-d", 'A "quoted" app']);
    const files = await listFiles(projectPath);

    assert.ok(files.includes(".gitignore"), "shared .gitignore is copied");
    assert.ok(!files.includes("gitignore"), "undotted gitignore is not left");
    assert.ok(!files.includes("npmignore"), "undotted npmignore is not left");

    const packageJson = JSON.parse(
      await readFile(path.join(projectPath, "package.json"), "utf8"),
    );
    assert.equal(packageJson.name, "my-app");

    for (const file of files) {
      if (/\.(woff2|png|ico)$/.test(file)) continue;
      const content = await readFile(path.join(projectPath, file), "utf8");
      assert.doesNotMatch(content, /\{\{[a-z-]+\}\}/, `${file} placeholders`);
    }
  });
}

test("tanstack gets its .npmignore back", async () => {
  const projectPath = await scaffold("tanstack");
  assert.ok(existsSync(path.join(projectPath, ".npmignore")));
});

test("hono uses the requested port", async () => {
  const projectPath = await scaffold("hono", ["-p", "8080"]);
  const envExample = await readFile(
    path.join(projectPath, ".env.example"),
    "utf8",
  );
  assert.match(envExample, /8080/);
});

test("refuses to overwrite an existing directory", async () => {
  const projectPath = await scaffold("vite");
  const result = run(
    ["my-app", "-t", "vite", "--skip-install", "--skip-git", "--no-agents"],
    path.dirname(projectPath),
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /already exists/);
});
