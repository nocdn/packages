#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const githubHost = "github.com";

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

    await ensureGitHubCli();
    await ensureGitHubAuth();

    const answers = await promptForRepository(args.repoName);
    const repository = await resolveRepository(answers.repoName);

    process.stdout.write(`\nCreating ${repository.fullName} on GitHub...\n`);
    await createBlankRepository(repository.fullName, answers);
    process.stdout.write(`\n${setupInstructions(repository)}\n`);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(argv, packageInfo) {
  const args = {
    help: false,
    version: false,
    repoName: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }

    if (arg === "-v" || arg === "--version") {
      args.version = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(
        `Unknown option "${arg}". Run ${commandName(packageInfo)} --help for usage.`,
      );
    }

    if (args.repoName) {
      throw new Error(
        `Unexpected argument "${arg}". Run ${commandName(packageInfo)} --help for usage.`,
      );
    }

    args.repoName = arg;
  }

  return args;
}

async function ensureGitHubCli() {
  try {
    await runGh(["--version"]);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "GitHub CLI (`gh`) is required. Install it from https://cli.github.com/ and run `gh auth login`, then try again.",
      );
    }

    throw new Error(`Could not run GitHub CLI (gh): ${commandErrorOutput(error)}`);
  }
}

async function ensureGitHubAuth() {
  try {
    await runGh(["auth", "status", "--hostname", githubHost]);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(
        "GitHub CLI (`gh`) is required. Install it from https://cli.github.com/ and run `gh auth login`, then try again.",
      );
    }

    throw new Error(
      "You are not authenticated with GitHub CLI for github.com. Run `gh auth login` first, then try again.",
    );
  }
}

async function promptForRepository(repoNameFromArgs) {
  const prompt = createPrompt();

  try {
    const defaultRepoName = path.basename(process.cwd());
    const repoName = repoNameFromArgs || (await askWithDefault(prompt, "Repository name", defaultRepoName));
    const description = (await prompt.question("Description (optional): ")).trim();
    const visibility = await askVisibility(prompt);

    return {
      repoName: normalizeRepositoryInput(repoName),
      description,
      visibility,
    };
  } finally {
    prompt.close();
  }
}

function createPrompt() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });
  const lines = rl[Symbol.asyncIterator]();

  return {
    async question(message) {
      process.stdout.write(message);
      const nextLine = await lines.next();
      return nextLine.done ? "" : nextLine.value;
    },
    close() {
      rl.close();
    },
  };
}

async function askWithDefault(prompt, label, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await prompt.question(`${label}${suffix}: `)).trim();
  return answer || defaultValue;
}

async function askVisibility(prompt) {
  while (true) {
    const answer = (await prompt.question("Visibility (public/private) [public]: "))
      .trim()
      .toLowerCase();

    if (!answer || answer === "public") {
      return "public";
    }

    if (answer === "private") {
      return "private";
    }

    process.stdout.write('Please enter "public" or "private".\n');
  }
}

function normalizeRepositoryInput(repoName) {
  const normalized = repoName.trim().replace(/\.git$/i, "");

  if (!normalized) {
    throw new Error("Repository name is required.");
  }

  if (/\s/.test(normalized)) {
    throw new Error("Repository name cannot contain spaces.");
  }

  const parts = normalized.split("/");

  if (parts.length > 2 || parts.some((part) => part.length === 0)) {
    throw new Error('Use a repository name like "my-repo" or "owner/my-repo".');
  }

  return normalized;
}

async function resolveRepository(repoName) {
  const parts = repoName.split("/");

  if (parts.length === 2) {
    return {
      owner: parts[0],
      name: parts[1],
      fullName: repoName,
    };
  }

  const owner = await authenticatedLogin();

  return {
    owner,
    name: repoName,
    fullName: `${owner}/${repoName}`,
  };
}

async function authenticatedLogin() {
  try {
    const { stdout } = await runGh(["api", "user", "--jq", ".login"]);
    const login = stdout.trim();

    if (!login) {
      throw new Error("GitHub did not return a username.");
    }

    return login;
  } catch (error) {
    throw new Error(
      `Could not read the authenticated GitHub username. Run \`gh auth login\` first, then try again. ${commandErrorOutput(error)}`,
    );
  }
}

async function createBlankRepository(fullName, answers) {
  const args = ["repo", "create", fullName, `--${answers.visibility}`];

  if (answers.description) {
    args.push("--description", answers.description);
  }

  try {
    await runGh(args);
  } catch (error) {
    throw new Error(
      `GitHub CLI could not create ${fullName}. ${commandErrorOutput(error)}`,
    );
  }
}

function setupInstructions(repository) {
  const remoteUrl = `https://${githubHost}/${repository.fullName}.git`;

  return `Created https://${githubHost}/${repository.fullName}

Quick setup — if you've done this kind of thing before
  HTTPS: ${remoteUrl}

…or create a new repository on the command line

echo "# ${repository.name}" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin ${remoteUrl}
git push -u origin main

…or push an existing repository from the command line

git remote add origin ${remoteUrl}
git branch -M main
git push -u origin main`;
}

async function runGh(args) {
  return execFileAsync("gh", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function commandErrorOutput(error) {
  const output = [error.stderr, error.stdout]
    .map((value) => (value ? String(value).trim() : ""))
    .filter(Boolean)
    .join("\n");

  return output || error.message;
}

async function readPackageInfo() {
  const packageJsonPath = new URL("../package.json", import.meta.url);
  const rawPackageJson = await readFile(packageJsonPath, "utf8");
  return JSON.parse(rawPackageJson);
}

function commandName(packageInfo) {
  return Object.keys(packageInfo.bin || {})[0] || packageInfo.name;
}

function helpText(packageInfo) {
  const command = commandName(packageInfo);
  const description = packageInfo.description || "";
  return `${packageInfo.name} ${packageInfo.version}
${description ? `\n${description}\n` : ""}
Usage:
  ${command} [repo-name] [options]

Creates a blank GitHub repository with GitHub CLI, then prints the same
command-line setup instructions GitHub shows for a new empty repository.

Before using this CLI, install GitHub CLI and authenticate:
  gh auth login

Examples:
  ${command}
  ${command} my-new-repo
  ${command} my-org/my-new-repo
  ${command} --help
  ${command} --version

Arguments:
  repo-name                         Optional repository name. Defaults to the
                                    current folder name. Use owner/name to
                                    create under an organization.

Options:
  -h, --help                       Show this help text.
  -v, --version                    Show the package version.
`;
}

main();
