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

async function invoke(args) {
  let stdout = ""
  let stderr = ""

  const exitCode = await runCli(args, {
    packageInfo,
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

test("runs the command when no options are provided", async () => {
  assert.deepEqual(await invoke([]), {
    exitCode: 0,
    stdout: "Hello World!\n",
    stderr: "",
  })
})

test("prints help using the package name and executable name", async () => {
  const result = await invoke(["--help"])

  assert.equal(result.exitCode, 0)
  assert.equal(result.stderr, "")
  assert.match(result.stdout, /^@example\/example-cli 1\.2\.3$/m)
  assert.match(result.stdout, /^ {2}example-cli \[options\]$/m)
  assert.match(result.stdout, /An example CLI/)
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
