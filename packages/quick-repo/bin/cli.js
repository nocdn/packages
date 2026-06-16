#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

    if (args.init) {
      process.stdout.write("\nInitializing local git repository...\n");
      await initializeLocalRepository();
    }

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
    init: false,
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

    if (arg === "--init") {
      args.init = true;
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
  const input = process.stdin;
  const wasPaused = input.isPaused();
  const lines = [];
  const waiters = [];
  let buffer = "";
  let ended = false;

  input.setEncoding("utf8");

  function queueLine(line) {
    const waiter = waiters.shift();

    if (waiter) {
      waiter(line);
      return;
    }

    lines.push(line);
  }

  function readBufferedLine() {
    const lineFeedIndex = buffer.indexOf("\n");
    const carriageReturnIndex = buffer.indexOf("\r");

    if (lineFeedIndex === -1 && carriageReturnIndex === -1) {
      return null;
    }

    const indexes = [lineFeedIndex, carriageReturnIndex].filter((index) => index !== -1);
    const newlineIndex = Math.min(...indexes);
    const line = buffer.slice(0, newlineIndex);
    const hasWindowsNewline =
      buffer[newlineIndex] === "\r" && buffer[newlineIndex + 1] === "\n";

    buffer = buffer.slice(newlineIndex + (hasWindowsNewline ? 2 : 1));

    return line;
  }

  function flushLines() {
    let line = readBufferedLine();

    while (line !== null) {
      queueLine(line);
      line = readBufferedLine();
    }
  }

  function onData(chunk) {
    buffer += chunk;
    flushLines();
  }

  function onEnd() {
    ended = true;

    if (buffer) {
      queueLine(buffer);
      buffer = "";
    }

    while (waiters.length > 0) {
      waiters.shift()("");
    }
  }

  input.on("data", onData);
  input.on("end", onEnd);
  input.resume();

  return {
    async question(message) {
      process.stdout.write(message);

      if (lines.length > 0) {
        return lines.shift();
      }

      if (ended) {
        return "";
      }

      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    close() {
      input.off("data", onData);
      input.off("end", onEnd);

      if (wasPaused) {
        input.pause();
      }
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

async function initializeLocalRepository() {
  await runGitStep(["init"]);
  await runGitStep(["add", "."]);
  await runGitStep(["commit", "-m", "init: initial file upload"]);
}

async function runGitStep(args) {
  try {
    await runGit(args);
  } catch (error) {
    throw new Error(
      `Could not run \`${formatCommand("git", args)}\`. ${commandErrorOutput(error)}`,
    );
  }
}

function setupInstructions(repository) {
  const remoteUrl = `https://${githubHost}/${repository.fullName}.git`;

  return `Created https://${githubHost}/${repository.fullName}

If you'd like to push an existing repository from the command line:

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

async function runGit(args) {
  return execFileAsync("git", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function formatCommand(command, args) {
  return [command, ...args.map(shellQuote)].join(" ");
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
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

Creates a blank GitHub repository with GitHub CLI, then prints the commands to
push an existing local repository.

Before using this CLI, install GitHub CLI and authenticate:
  gh auth login

Examples:
  ${command}
  ${command} my-new-repo
  ${command} my-org/my-new-repo
  ${command} --init
  ${command} --help
  ${command} --version

Arguments:
  repo-name                         Optional repository name. Defaults to the
                                    current folder name. Use owner/name to
                                    create under an organization.

Options:
      --init                       Run git init, git add ., and git commit
                                    before creating the GitHub repo.
  -h, --help                       Show this help text.
  -v, --version                    Show the package version.
`;
}

main();
