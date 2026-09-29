#!/usr/bin/env node
// Runs an npm command that needs the owner's browser approval (npm login,
// a 2FA-protected npm publish, npm trust ...) on the owner's machine, and opens
// each approval page in their browser as soon as npm prints it. npm only
// offers browser approval when attached to a terminal, so the command runs in
// a pseudo-terminal via script(1). The owner approves in the browser; nothing
// here can approve on their behalf.
//
// Usage: node scripts/npm-browser-auth.js <npm arguments...>
//   node scripts/npm-browser-auth.js login --auth-type=web
//   node scripts/npm-browser-auth.js publish --workspace packages/x --access public
//   node scripts/npm-browser-auth.js trust github @nocdn/x --repo nocdn/packages --file publish.yml --allow-publish -y
import { spawn } from "node:child_process";
import process from "node:process";

const npmArgs = process.argv.slice(2);
if (npmArgs.length === 0) {
  console.error("Usage: node scripts/npm-browser-auth.js <npm arguments...>");
  process.exit(2);
}

const quote = (arg) => `'${arg.replaceAll("'", "'\\''")}'`;
const [command, args] =
  process.platform === "darwin"
    ? ["script", ["-q", "/dev/null", "npm", ...npmArgs]]
    : [
        "script",
        ["-qefc", ["npm", ...npmArgs].map(quote).join(" "), "/dev/null"],
      ];
const opener = process.platform === "darwin" ? "open" : "xdg-open";
const approvalUrl =
  /https:\/\/www\.npmjs\.com\/(?:auth\/cli\/[\w-]+|login\?next=\/login\/cli\/[\w-]+)/;

const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
const opened = new Set();
let output = "";

function onData(chunk) {
  output += chunk;
  for (const [url] of output.matchAll(new RegExp(approvalUrl, "g"))) {
    if (opened.has(url)) continue;
    opened.add(url);
    console.log(`>> Approve in the browser: ${url}`);
    spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
  }
}
child.stdout.setEncoding("utf8").on("data", onData);
child.stderr.setEncoding("utf8").on("data", onData);

child.on("close", (code) => {
  // Strip the pty's echoed "^D", terminal control sequences, spinner frames
  // and the prompts already handled above, and print what npm reported.
  const escape = String.fromCharCode(27);
  const backspace = String.fromCharCode(8);
  const cleaned = output
    .replaceAll(`^D${backspace}${backspace}`, "")
    .replace(new RegExp(`${escape}\\[[0-9;?]*[A-Za-z]`, "g"), "")
    .replace(/[⠀-⣿]/g, "")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/Press ENTER|Authenticate your account at|^Login at:/.test(line) &&
        !approvalUrl.test(line),
    );
  console.log(cleaned.join("\n"));
  process.exitCode = code ?? 1;
});
