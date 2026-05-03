#!/usr/bin/env bun
import path from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import { ingestPath, writeDigest } from "../src/ingest.js";
import { TEMPLATE_PATTERNS } from "../src/patterns.js";

const DEFAULT_OUTPUT = "digest.txt";

async function main() {
  const packageInfo = await readPackageInfo();

  try {
    const args = parseArgs(process.argv.slice(2), packageInfo);

    if (args.help) {
      process.stdout.write(helpText(packageInfo));
      return;
    }

    if (args.version) {
      process.stdout.write(`${packageInfo.version}\n`);
      return;
    }

    if (args.listTemplates) {
      process.stdout.write(templateListText());
      return;
    }

    validateOutputMode(args);

    const result = await ingestPath(args.source, {
      cwd: process.cwd(),
      include: args.include,
      exclude: args.exclude,
      templates: args.templates,
      includeDangerous: args.includeDangerous,
      includeGitignored: args.includeGitignored,
      ignoreFiles: args.ignoreFiles,
      maxFileSize: args.maxSize,
      includePdf: args.includePdf,
      includeEnv: args.includeEnv,
      lineNumbers: args.lineNumbers,
      dryRun: args.dryRun,
      verbose: args.verbose,
    });

    if (args.dryRun) {
      const lines = [
        "Dry run — no digest produced.",
        "",
        result.summary,
        `Total size: ${result.totalSize.toLocaleString("en-US")} bytes`,
        "",
        result.tree,
        "Files that would be included:",
        ...result.files.map((file) => {
          const tag = file.type === "symlink" ? " [symlink]" : "";
          return `  ${file.relativePath}${tag} (${file.size.toLocaleString("en-US")} bytes)`;
        }),
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
      return;
    }

    if (args.stdout) {
      process.stdout.write(result.digest);
      return;
    }

    if (args.output !== null) {
      const outputName = args.output || DEFAULT_OUTPUT;
      const outputPath = await writeDigest(outputName, result.digest, process.cwd());
      process.stdout.write(`Analysis complete. Output written to: ${outputPath}\n\n${result.summary}\n`);
      return;
    }

    if (args.noClipboard) {
      process.stdout.write(`Analysis complete. No output target was used.\n\n${result.summary}\n`);
      return;
    }

    await copyToClipboard(result.digest);
    process.stdout.write(`Analysis complete. Digest copied to clipboard.\n\n${result.summary}\n`);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(argv, packageInfo) {
  const args = {
    source: ".",
    include: [],
    exclude: [],
    templates: [],
    ignoreFiles: [".gitignore", ".gitingestignore"],
    output: null,
    stdout: false,
    noClipboard: false,
    includeDangerous: false,
    includeGitignored: false,
    includePdf: false,
    includeEnv: false,
    lineNumbers: false,
    dryRun: false,
    verbose: false,
    listTemplates: false,
    maxSize: 10 * 1024 * 1024,
    help: false,
    version: false,
  };

  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }

    if (arg === "--verbose") {
      args.verbose = true;
      continue;
    }

    if (arg === "-v" || arg === "--version") {
      args.version = true;
      continue;
    }

    if (arg === "-L" || arg === "--list-templates") {
      args.listTemplates = true;
      continue;
    }

    if (arg === "-S" || arg === "--stdout") {
      args.stdout = true;
      continue;
    }

    if (arg === "-n" || arg === "--no-clipboard") {
      args.noClipboard = true;
      continue;
    }

    if (arg === "-d" || arg === "--include-dangerous") {
      args.includeDangerous = true;
      continue;
    }

    if (arg === "-g" || arg === "--include-gitignored") {
      args.includeGitignored = true;
      continue;
    }

    if (arg === "--include-pdf") {
      args.includePdf = true;
      continue;
    }

    if (arg === "-N" || arg === "--line-numbers") {
      args.lineNumbers = true;
      continue;
    }

    if (arg === "--include-env") {
      args.includeEnv = true;
      continue;
    }

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "-o" || arg === "--output") {
      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        args.output = next;
        index += 1;
      } else {
        args.output = "";
      }
      continue;
    }

    if (arg.startsWith("--output=")) {
      args.output = arg.slice("--output=".length) || "";
      continue;
    }

    if (arg === "-i" || arg === "--include") {
      const values = collectValues(argv, index + 1, "--include");
      args.include.push(...values.items);
      index = values.nextIndex - 1;
      continue;
    }

    if (arg.startsWith("--include=")) {
      args.include.push(arg.slice("--include=".length));
      continue;
    }

    if (arg === "-e" || arg === "--exclude") {
      const values = collectValues(argv, index + 1, "--exclude");
      args.exclude.push(...values.items);
      index = values.nextIndex - 1;
      continue;
    }

    if (arg.startsWith("--exclude=")) {
      args.exclude.push(arg.slice("--exclude=".length));
      continue;
    }

    if (arg === "-T" || arg === "--template" || arg === "--exclude-template") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`${arg} requires a template name. Available templates: ${availableTemplates()}`);
      }
      args.templates.push(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--template=")) {
      args.templates.push(arg.slice("--template=".length));
      continue;
    }

    if (arg.startsWith("--exclude-template=")) {
      args.templates.push(arg.slice("--exclude-template=".length));
      continue;
    }

    if (arg === "-F" || arg === "--ignore-file") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`${arg} requires an ignore filename.`);
      }
      args.ignoreFiles.push(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--ignore-file=")) {
      args.ignoreFiles.push(arg.slice("--ignore-file=".length));
      continue;
    }

    if (arg === "-s" || arg === "--max-size") {
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) {
        throw new Error(`${arg} requires a byte size.`);
      }
      args.maxSize = parseSize(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--max-size=")) {
      args.maxSize = parseSize(arg.slice("--max-size=".length));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}". Run ${packageInfo.name} --help for usage.`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 1) {
    throw new Error(`Expected at most one path, received: ${positionals.join(", ")}`);
  }

  if (positionals[0]) {
    args.source = positionals[0];
  }

  return args;
}

function collectValues(argv, startIndex, optionName) {
  const items = [];
  let index = startIndex;

  while (index < argv.length && !argv[index].startsWith("-")) {
    items.push(argv[index]);
    index += 1;
  }

  if (items.length === 0) {
    throw new Error(`${optionName} requires at least one file or pattern.`);
  }

  return { items, nextIndex: index };
}

function validateOutputMode(args) {
  const outputModes = [args.output !== null, args.stdout, args.noClipboard].filter(Boolean).length;
  if (outputModes > 1) {
    throw new Error("Choose only one output mode: --output, --stdout, or --no-clipboard.");
  }
}

function parseSize(value) {
  const size = Number.parseInt(value, 10);
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`Invalid size "${value}".`);
  }

  return size;
}

async function copyToClipboard(text) {
  try {
    const clipboardy = await import("clipboardy");
    await clipboardy.default.write(text);
  } catch (error) {
    try {
      await copyToClipboardWithPlatformTool(text);
    } catch {
      throw new Error(`Unable to copy to clipboard with clipboardy: ${error.message}`);
    }
  }
}

function copyToClipboardWithPlatformTool(text) {
  const command = platformClipboardCommand();
  if (!command) {
    return Promise.reject(new Error("No platform clipboard command is available."));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command.bin, command.args, { stdio: ["pipe", "ignore", "ignore"] });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command.bin} exited with code ${code}`));
      }
    });

    child.stdin.end(text);
  });
}

function platformClipboardCommand() {
  if (process.platform === "darwin") {
    return { bin: "pbcopy", args: [] };
  }

  if (process.platform === "win32") {
    return { bin: "clip", args: [] };
  }

  return { bin: "xclip", args: ["-selection", "clipboard"] };
}

async function readPackageInfo() {
  const packageJsonPath = new URL("../package.json", import.meta.url);
  const rawPackageJson = await readFile(packageJsonPath, "utf8");
  return JSON.parse(rawPackageJson);
}

function availableTemplates() {
  return Object.keys(TEMPLATE_PATTERNS).join(", ");
}

function templateListText() {
  const names = Object.keys(TEMPLATE_PATTERNS).sort();
  return `${names.map((name) => `${name} (${TEMPLATE_PATTERNS[name].length} patterns)`).join("\n")}\n`;
}

function helpText(packageInfo) {
  const command = packageInfo.name;
  return `${command} ${packageInfo.version}

Usage:
  ${command} [path] [options]

Examples:
  ${command}
  ${command} .
  ${command} ../my-app -o
  ${command} ../my-app -o squeeze.txt
  ${command} . -i "src/**/*.ts" README.md
  ${command} . -e "*.ts" ".next/" -T nextjs
  ${command} --stdout | pbcopy

Options:
  -h, --help                       Show this help text.
  -v, --version                    Show the package version.
      --verbose                    Print debug information during processing.
  -L, --list-templates             List available exclusion templates.
  -o, --output [file]              Write the digest to a file. Without a file, writes digest.txt in the current directory.
  -S, --stdout                     Write the full digest to stdout and do not print status text.
  -n, --no-clipboard               Do not copy or write the digest; print only the status summary.
  -i, --include <patterns...>      Include only matching files. Directories are still traversed to find matches.
  -e, --exclude <patterns...>      Exclude files or directories. Accepts repeated, space-separated, or comma-separated patterns.
  -T, --template <name>            Apply an exclusion template. Alias: --exclude-template. Available: ${availableTemplates()}.
  -d, --include-dangerous          Include paths excluded by the built-in safety defaults, such as node_modules and .git.
  -g, --include-gitignored         Include files matched by .gitignore and .gitingestignore.
  -F, --ignore-file <file>         Also load ignore patterns from this file name, for example .customignore.
  -s, --max-size <bytes>           Maximum size of one file to include. Default: 10485760.
      --include-pdf                Extract text from PDF files and include it in the digest.
      --include-env                Include .env files that are excluded by built-in defaults and templates.
  -N, --line-numbers               Prefix each line of file content with its line number.
      --dry-run                    Print the files that would be included with sizes without producing or copying a digest.

By default the digest is copied to the clipboard with clipboardy.
`;
}

main();
