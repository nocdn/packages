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

    const answers = await promptForRepository(args);
    const repository = await resolveRepository(answers.repoName);

    if (args.init) {
      process.stdout.write("\nInitializing local git repository...\n");
      await initializeLocalRepository();
    }

    process.stdout.write(`\nCreating ${repository.fullName} on GitHub...\n`);
    await createBlankRepository(repository.fullName, answers);

    if (args.push) {
      process.stdout.write("\nPushing local repository to GitHub...\n");
      await pushLocalRepository(repository);
      process.stdout.write(`\nCreated and pushed https://${githubHost}/${repository.fullName}\n`);
      return;
    }

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
    push: false,
    description: undefined,
    visibility: "",
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

    if (arg === "--push") {
      args.push = true;
      continue;
    }

    if (arg === "--public" || arg === "--private") {
      const visibility = arg.slice(2);

      if (args.visibility && args.visibility !== visibility) {
        throw new Error('Choose either "--public" or "--private", not both.');
      }

      args.visibility = visibility;
      continue;
    }

    if (arg === "-d" || arg === "--description") {
      const value = readOptionValue(argv, index, arg, packageInfo);
      args.description = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--description=")) {
      args.description = arg.slice("--description=".length);
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

function readOptionValue(argv, index, option, packageInfo) {
  const value = argv[index + 1];

  if (value === undefined || isKnownOption(value)) {
    throw new Error(
      `Option "${option}" requires a value. Run ${commandName(packageInfo)} --help for usage.`,
    );
  }

  return value;
}

function isKnownOption(value) {
  return [
    "-h",
    "--help",
    "-v",
    "--version",
    "--init",
    "--push",
    "--public",
    "--private",
    "-d",
    "--description",
  ].includes(value);
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

async function promptForRepository(args) {
  const prompt = createPrompt();

  try {
    const defaultRepoName = path.basename(process.cwd());
    const repoName = args.repoName || (await askWithDefault(prompt, "Repository name", defaultRepoName));
    const description =
      args.description === undefined
        ? (await prompt.question("Description (optional): ")).trim()
        : args.description.trim();
    const visibility = args.visibility || (await askVisibility(prompt));

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

  try {
    await runGit(["commit", "-m", "init: initial file upload"]);
  } catch (error) {
    throw friendlyGitCommitError(error);
  }
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

function friendlyGitCommitError(error) {
  const output = commandErrorOutput(error);
  const normalizedOutput = output.toLowerCase();

  if (
    normalizedOutput.includes("author identity unknown") ||
    normalizedOutput.includes("please tell me who you are") ||
    normalizedOutput.includes("unable to auto-detect email address")
  ) {
    return new Error(
      'Git needs your name and email before it can create the initial commit. Run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, then try again.',
    );
  }

  if (normalizedOutput.includes("nothing to commit")) {
    if (normalizedOutput.includes("working tree clean")) {
      return new Error(
        "There are no staged changes to commit. If this repository already has a commit, run without `--init` or use `--push` only.",
      );
    }

    return new Error(
      "No files were available to commit. Add files to this folder or run without `--init`.",
    );
  }

  if (normalizedOutput.includes("no changes added to commit")) {
    return new Error(
      "No files were staged for the initial commit. Add files to this folder or run without `--init`.",
    );
  }

  return new Error(
    `Could not run \`git commit -m "init: initial file upload"\`. ${output}`,
  );
}

async function pushLocalRepository(repository) {
  const remoteUrl = repositoryRemoteUrl(repository);

  await runGitStep(["remote", "add", "origin", remoteUrl]);
  await runGitStep(["branch", "-M", "main"]);
  await runGitStep(["push", "-u", "origin", "main"]);
}

function setupInstructions(repository) {
  const remoteUrl = repositoryRemoteUrl(repository);

  return `Created https://${githubHost}/${repository.fullName}

If you'd like to push an existing repository from the command line:

git remote add origin ${remoteUrl}
git branch -M main
git push -u origin main`;
}

function repositoryRemoteUrl(repository) {
  return `https://${githubHost}/${repository.fullName}.git`;
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
  ${command} my-new-repo --private --description "My app" --init
  ${command} --init --push
  ${command} --init
  ${command} --help
  ${command} --version

Arguments:
  repo-name                         Optional repository name. Defaults to the
                                    current folder name. Use owner/name to
                                    create under an organization.

Options:
  -d, --description <text>         Use this repository description without
                                    prompting.
      --public                     Create a public repository without prompting.
      --private                    Create a private repository without prompting.
      --init                       Run git init, git add ., and git commit
                                    before creating the GitHub repo.
      --push                       Add origin, rename the branch to main, and
                                    push after creating the GitHub repo.
  -h, --help                       Show this help text.
  -v, --version                    Show the package version.
`;
}

main();
