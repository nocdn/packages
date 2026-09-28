import { readFile } from "node:fs/promises"
import process from "node:process"
import { URL } from "node:url"
import { parseArgs } from "node:util"

const options = {
  help: {
    type: "boolean",
    short: "h",
  },
  version: {
    type: "boolean",
    short: "v",
  },
}

export async function runCli(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    packageInfo: providedPackageInfo,
  } = {},
) {
  const packageInfo = normalizePackageInfo(
    providedPackageInfo ?? (await readPackageInfo()),
  )
  let values

  try {
    const parsed = parseArgs({
      args: argv,
      options,
      strict: true,
      allowPositionals: false,
    })
    values = parsed.values
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stderr.write(
      `Error: ${message}\nRun ${packageInfo.command} --help for usage.\n`,
    )
    return 2
  }

  if (values.help) {
    stdout.write(helpText(packageInfo))
    return 0
  }

  if (values.version) {
    stdout.write(`${packageInfo.version}\n`)
    return 0
  }

  stdout.write("Hello World!\n")
  return 0
}

export async function readPackageInfo(
  packageJsonUrl = new URL("../package.json", import.meta.url),
) {
  const rawPackageJson = await readFile(packageJsonUrl, "utf8")
  return JSON.parse(rawPackageJson)
}

function normalizePackageInfo(packageInfo) {
  const command = Object.keys(packageInfo?.bin ?? {})[0]

  if (
    typeof packageInfo?.name !== "string" ||
    typeof packageInfo.version !== "string" ||
    !command
  ) {
    throw new Error(
      "package.json must define name, version, and one bin command",
    )
  }

  return {
    name: packageInfo.name,
    version: packageInfo.version,
    description:
      typeof packageInfo.description === "string"
        ? packageInfo.description
        : "",
    command,
  }
}

function helpText(packageInfo) {
  const { command, description, name, version } = packageInfo

  return `${name} ${version}
${description ? `\n${description}\n` : ""}
Usage:
  ${command} [options]

Options:
  -h, --help       Show this help text.
  -v, --version    Show the package version.
`
}
