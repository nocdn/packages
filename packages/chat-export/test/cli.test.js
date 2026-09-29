import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import process from "node:process"
import { fileURLToPath, URL } from "node:url"
import test from "node:test"

import { runCli } from "../src/cli.js"

const packageInfo = {
  name: "@example/example-cli",
  version: "1.2.3",
  description: "An example CLI",
  bin: {
    "example-cli": "bin/cli.js",
  },
}

async function invoke(args, { isTTY = false } = {}) {
  let stdout = ""
  let stderr = ""

  const exitCode = await runCli(args, {
    packageInfo,
    stdin: { isTTY },
    stdout: {
      write(chunk) {
        stdout += chunk
      },
    },
    stderr: {
      write(chunk) {
        stderr += chunk
      },
    },
  })

  return { exitCode, stdout, stderr }
}

test("refuses to open a picker without a terminal", async () => {
  const result = await invoke([])

  assert.equal(result.exitCode, 1)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /Run the picker in a terminal/)
})

test("prints help using the package name and executable name", async () => {
  const result = await invoke(["--help"])

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, "")
  assert.match(result.stdout, /^@example\/example-cli 1\.2\.3$/m)
  assert.match(result.stdout, /^ {2}example-cli \[options\]$/m)
  assert.match(result.stdout, /An example CLI/)
  for (const flag of [
    "--provider",
    "--picker",
    "--codex-home",
    "--db",
    "--t3-db",
    "--session",
    "--list",
    "--json",
    "--stdout",
    "--no-reasoning",
    "--exact",
    "--query",
    "--last",
    "--here",
    "--cwd",
    "--format",
    "--user-only",
    "--tools",
    "--no-preview",
  ]) {
    assert.match(result.stdout, new RegExp(`^ {2}${flag} `, "m"))
  }
  assert.match(result.stdout, /^ {2}-o, --output FILE /m)
})

test("supports short and combined help and version options", async () => {
  assert.equal((await invoke(["-v"])).stdout, "1.2.3\n")
  assert.match((await invoke(["-hv"])).stdout, /Usage:/)
})

test("rejects unknown options", async () => {
  const result = await invoke(["--unknown"])

  assert.equal(result.exitCode, 2)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /Unknown option '--unknown'/)
  assert.match(result.stderr, /Run example-cli --help for usage\./)
})

test("rejects invalid option values and combinations", async () => {
  for (const [args, message] of [
    [["--provider", "claude"], /--provider must be codex, opencode, or t3code/],
    [["--picker", "gum"], /--picker must be auto, fzf, or inquirer/],
    [["--json"], /--json requires --list/],
    [["--list", "--stdout"], /--list cannot be combined/],
    [["--list", "--session", "x"], /--list cannot be combined/],
  ]) {
    const result = await invoke(args)

    assert.equal(result.exitCode, 2, args.join(" "))
    assert.equal(result.stdout, "")
    assert.match(result.stderr, message)
    assert.match(result.stderr, /Run example-cli --help for usage\./)
  }
})

test("rejects positional arguments, including after --", async () => {
  for (const args of [["unexpected"], ["--", "unexpected"]]) {
    const result = await invoke(args)

    assert.equal(result.exitCode, 2)
    assert.equal(result.stdout, "")
    assert.match(result.stderr, /does not take positional arguments/)
  }
})

test("the executable reads its version from package.json", async () => {
  const packageJsonUrl = new URL("../package.json", import.meta.url)
  const actualPackageInfo = JSON.parse(await readFile(packageJsonUrl, "utf8"))
  const executable = fileURLToPath(new URL("../bin/cli.js", import.meta.url))
  const result = spawnSync(process.execPath, [executable, "--version"], {
    encoding: "utf8",
  })

  assert.equal(result.status, 0)
  assert.equal(result.stdout, `${actualPackageInfo.version}\n`)
  assert.equal(result.stderr, "")
})

test("the executable returns usage errors on stderr", () => {
  const executable = fileURLToPath(new URL("../bin/cli.js", import.meta.url))
  const result = spawnSync(process.execPath, [executable, "--unknown"], {
    encoding: "utf8",
  })

  assert.equal(result.status, 2)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /Unknown option '--unknown'/)
})
