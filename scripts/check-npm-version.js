#!/usr/bin/env node
// Fails unless the npm on PATH is at least the given version. Trusted
// publishing silently falls back to token auth (and fails) on older npm.
//
// Usage: node scripts/check-npm-version.js <minimum-version>
import { execFileSync } from "node:child_process";
import process from "node:process";

const minimum = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(minimum ?? "")) {
  console.error("Usage: node scripts/check-npm-version.js <major.minor.patch>");
  process.exit(2);
}

const current = execFileSync("npm", ["--version"], {
  encoding: "utf8",
  shell: process.platform === "win32",
}).trim();

const parse = (version) => version.split(/[.-]/).slice(0, 3).map(Number);
const [a, b] = [parse(current), parse(minimum)];
const cmp = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

if (cmp < 0) {
  console.error(`npm ${current} is older than ${minimum}.`);
  process.exit(1);
}
console.log(`npm ${current} (>= ${minimum})`);
