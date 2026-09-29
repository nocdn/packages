#!/usr/bin/env node
// Lists the workspaces whose package.json version is not on npm yet, i.e. the
// ones a push to main should publish. Bumping a package's version is what
// releases it; every other push publishes nothing.
//
// Usage: node scripts/release-plan.js [--only <name>] [--exclude <name>]...
// In GitHub Actions it also writes `packages` (JSON array) and `any` outputs.
import { execFile } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const { values } = parseArgs({
  options: {
    only: { type: "string", multiple: true, default: [] },
    exclude: { type: "string", multiple: true, default: [] },
  },
});

async function isPublished(name, version) {
  try {
    await execFileAsync(
      "npm",
      ["view", `${name}@${version}`, "version", "--json"],
      { shell: process.platform === "win32" },
    );
    return true;
  } catch (error) {
    // Only a 404 means "not published". Anything else (network, registry
    // outage) must fail the workflow instead of triggering a publish attempt.
    if (/E404|404 Not Found/.test(`${error.stdout}${error.stderr}`)) {
      return false;
    }
    throw new Error(`npm view ${name}@${version} failed:\n${error.stderr}`, {
      cause: error,
    });
  }
}

const packagesDir = path.join(repoRoot, "packages");
const candidates = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const dir = `packages/${entry.name}`;
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, dir, "package.json"), "utf8"),
    );
    return { dir, name: manifest.name, version: manifest.version, manifest };
  })
  .filter(({ manifest }) => !manifest.private)
  .filter(({ name }) => values.only.length === 0 || values.only.includes(name))
  .filter(({ name }) => !values.exclude.includes(name));

const plan = [];
for (const { dir, name, version } of candidates) {
  if (await isPublished(name, version)) {
    console.log(`= ${name}@${version} is already on npm`);
  } else {
    console.log(`+ ${name}@${version} will be published`);
    plan.push({ dir, name, version });
  }
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `packages=${JSON.stringify(plan)}\nany=${plan.length > 0}\n`,
  );
}
