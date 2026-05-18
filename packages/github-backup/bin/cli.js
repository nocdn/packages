#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_BACKUP_DIR = "~/backups/github";
const DEFAULT_TOKEN_FILE = "~/.config/github-backup/token";
const DEFAULT_B2_CREDENTIALS_FILE = "~/.config/github-backup/b2";
const DEFAULT_B2_BUCKET_PATH = "/github";
const DOCKER_IMAGE = "ghcr.io/josegonzalez/python-github-backup";
const TOKEN_CREATE_URL = "https://github.com/settings/personal-access-tokens/new";
const TOKEN_DOCS_URL =
  "https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token";
const B2_AUTHORIZE_URL = "https://api.backblazeb2.com/b2api/v4/b2_authorize_account";
const B2_MAX_SINGLE_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024;
const BACKUP_FLAGS = [
  "-P",
  "-F",
  "--repositories",
  "--bare",
  "--lfs",
  "--wikis",
  "--gists",
  "--starred-gists",
  "--starred",
  "--watched",
  "--followers",
  "--following",
  "--issues",
  "--issue-comments",
  "--issue-events",
  "--pulls",
  "--pull-comments",
  "--pull-commits",
  "--pull-details",
  "--labels",
  "--milestones",
  "--releases",
  "--attachments",
  "--hooks",
  "--security-advisories",
];

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

    const config = await collectConfig(args);
    checkRuntimeDependencies();
    await runBackup(config);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.stderr.write("Backup failed.\n");
    process.exitCode = 1;
  }
}

function parseArgs(argv, packageInfo) {
  const args = {
    backupDir: null,
    b2CredentialsFile: null,
    bucket: null,
    bucketPath: null,
    excludedRepos: [],
    excludedReposProvided: false,
    help: false,
    removeZipAfterUpload: false,
    upload: null,
    uploadRequested: false,
    user: null,
    version: false,
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

    if (arg === "-u" || arg === "--user") {
      args.user = readRequiredOptionValue(argv, index, arg, packageInfo);
      index += 1;
      continue;
    }

    if (arg.startsWith("--user=")) {
      args.user = readInlineOptionValue(arg, "--user", packageInfo);
      continue;
    }

    if (arg === "-b" || arg === "--backup-dir") {
      args.backupDir = readRequiredOptionValue(argv, index, arg, packageInfo);
      index += 1;
      continue;
    }

    if (arg.startsWith("--backup-dir=")) {
      args.backupDir = readInlineOptionValue(arg, "--backup-dir", packageInfo);
      continue;
    }

    if (arg === "--upload") {
      args.uploadRequested = true;
      if (argv[index + 1] && !argv[index + 1].startsWith("-")) {
        args.upload = argv[index + 1];
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--upload=")) {
      args.uploadRequested = true;
      args.upload = arg.slice("--upload=".length).trim() || null;
      continue;
    }

    if (arg === "--bucket") {
      args.bucket = readRequiredOptionValue(argv, index, arg, packageInfo);
      index += 1;
      continue;
    }

    if (arg.startsWith("--bucket=")) {
      args.bucket = readInlineOptionValue(arg, "--bucket", packageInfo);
      continue;
    }

    if (arg === "--bucket-path") {
      args.bucketPath = readRequiredOptionValue(argv, index, arg, packageInfo);
      index += 1;
      continue;
    }

    if (arg.startsWith("--bucket-path=")) {
      args.bucketPath = readInlineOptionValue(arg, "--bucket-path", packageInfo);
      continue;
    }

    if (arg === "--b2-credentials-file") {
      args.b2CredentialsFile = readRequiredOptionValue(argv, index, arg, packageInfo);
      index += 1;
      continue;
    }

    if (arg.startsWith("--b2-credentials-file=")) {
      args.b2CredentialsFile = readInlineOptionValue(arg, "--b2-credentials-file", packageInfo);
      continue;
    }

    if (arg === "--rm") {
      args.removeZipAfterUpload = true;
      continue;
    }

    if (arg === "-e" || arg === "--exclude") {
      const repos = [];
      while (argv[index + 1] && !argv[index + 1].startsWith("-")) {
        repos.push(...splitRepoList(argv[index + 1]));
        index += 1;
      }

      if (repos.length === 0) {
        throw new Error(`${arg} requires at least one repository name.`);
      }

      args.excludedRepos.push(...repos);
      args.excludedReposProvided = true;
      continue;
    }

    if (arg.startsWith("--exclude=")) {
      const repos = splitRepoList(readInlineOptionValue(arg, "--exclude", packageInfo));
      if (repos.length === 0) {
        throw new Error("--exclude requires at least one repository name.");
      }
      args.excludedRepos.push(...repos);
      args.excludedReposProvided = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(
        `Unknown option "${arg}". Run ${packageInfo.name} --help for usage.`,
      );
    }

    throw new Error(
      `Unexpected argument "${arg}". Run ${packageInfo.name} --help for usage.`,
    );
  }

  args.excludedRepos = unique(args.excludedRepos);
  validateUploadArgs(args);
  return args;
}

function validateUploadArgs(args) {
  if (args.upload && args.upload !== "b2") {
    throw new Error(`Unsupported upload target "${args.upload}". Supported target: b2.`);
  }

  if (!args.uploadRequested) {
    const uploadOnlyOptions = [];

    if (args.bucket) {
      uploadOnlyOptions.push("--bucket");
    }

    if (args.bucketPath) {
      uploadOnlyOptions.push("--bucket-path");
    }

    if (args.b2CredentialsFile) {
      uploadOnlyOptions.push("--b2-credentials-file");
    }

    if (args.removeZipAfterUpload) {
      uploadOnlyOptions.push("--rm");
    }

    if (uploadOnlyOptions.length > 0) {
      throw new Error(`${uploadOnlyOptions.join(", ")} requires --upload b2.`);
    }

    return;
  }
}

function readRequiredOptionValue(argv, index, option, packageInfo) {
  const value = argv[index + 1];

  if (!value || value.startsWith("-")) {
    throw new Error(
      `${option} requires a value. Run ${packageInfo.name} --help for usage.`,
    );
  }

  return value;
}

function readInlineOptionValue(arg, option, packageInfo) {
  const value = arg.slice(option.length + 1);

  if (!value) {
    throw new Error(
      `${option} requires a value. Run ${packageInfo.name} --help for usage.`,
    );
  }

  return value;
}

function splitRepoList(value) {
  return value
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);
}

async function collectConfig(args) {
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;

  try {
    const backupDirInput =
      args.backupDir ??
      (await promptForValue(rl, `Backup directory [${DEFAULT_BACKUP_DIR}]: `, {
        fallback: DEFAULT_BACKUP_DIR,
        name: "backup directory",
      }));
    const user =
      args.user ??
      (await promptForValue(rl, "GitHub username: ", {
        name: "GitHub username",
        required: true,
      }));

    let excludedRepos = args.excludedRepos;
    if (!args.excludedReposProvided && rl) {
      process.stdout.write("Repositories to exclude\n");
      process.stdout.write("Separate with spaces, for example: extensions repo2 repo3\n");
      const excludedInput = await promptForValue(rl, "Excluded repos [none]: ", {
        fallback: "",
        name: "excluded repos",
      });
      excludedRepos = excludedInput.split(/\s+/).filter(Boolean);
    }

    rl?.close();

    const backupDir = await prepareBackupDir(backupDirInput);
    const tokenFile = await prepareTokenFile();
    const upload = args.uploadRequested
      ? await prepareUploadConfig({
          bucket: args.bucket,
          bucketPath: args.bucketPath,
          credentialsFile: args.b2CredentialsFile,
          removeZipAfterUpload: args.removeZipAfterUpload,
          target: args.upload,
        })
      : null;

    return {
      backupDir,
      excludedRepos: unique(excludedRepos),
      tokenFile,
      upload,
      user: validateRequired(user, "GitHub username"),
    };
  } catch (error) {
    rl?.close();
    throw error;
  }
}

async function promptForValue(rl, prompt, { fallback, name, required = false }) {
  if (!rl) {
    if (fallback !== undefined) {
      return fallback;
    }

    throw new Error(`${name} is required when running non-interactively.`);
  }

  const answer = await rl.question(prompt);
  const value = answer.trim() || fallback || "";

  if (required) {
    return validateRequired(value, name);
  }

  return value;
}

function validateRequired(value, name) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    throw new Error(`${name} cannot be empty.`);
  }

  return normalized;
}

async function prepareBackupDir(input) {
  const requestedPath = expandHome(input);
  await mkdir(requestedPath, { recursive: true });

  const backupDir = await realpath(requestedPath);
  const homeDir = await realpathSafe(homedir());
  const cliPath = fileURLToPath(import.meta.url);

  if (backupDir === "/") {
    throw new Error("Refusing to use / as the backup directory.");
  }

  if (homeDir && backupDir === homeDir) {
    throw new Error(`Refusing to use ${backupDir} as the backup directory.`);
  }

  if (isPathInside(cliPath, backupDir)) {
    throw new Error(
      "The CLI itself is inside the backup directory. Move it elsewhere before running.",
    );
  }

  return backupDir;
}

async function prepareTokenFile() {
  const tokenFile = expandHome(DEFAULT_TOKEN_FILE);
  const tokenDir = dirname(tokenFile);

  await mkdir(tokenDir, { recursive: true });
  await chmod(tokenDir, 0o700);

  if (!(await fileHasContent(tokenFile))) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(
        `GitHub token not found at ${tokenFile}. Run interactively once or create that file manually.`,
      );
    }

    process.stdout.write("GitHub token not found, or the token file is empty.\n");
    process.stdout.write("This needs a GitHub fine-grained personal access token.\n");
    process.stdout.write(`Create one at: ${TOKEN_CREATE_URL}\n`);
    process.stdout.write("Choose access to the repositories and account data you want backed up.\n");
    const token = await promptHidden("Paste your fine-grained GitHub token and press Enter: ");
    const normalized = validateRequired(token, "GitHub token");
    await writeFile(tokenFile, `${normalized}\n`, { mode: 0o600 });
  }

  await chmod(tokenFile, 0o600);
  return tokenFile;
}

async function prepareUploadConfig(args) {
  const target = await resolveUploadTarget(args.target);

  if (target !== "b2") {
    throw new Error(`Unsupported upload target "${target}". Supported target: b2.`);
  }

  const bucketName = await resolveRequiredUploadValue(args.bucket, {
    name: "B2 bucket",
    prompt: "Backblaze B2 bucket: ",
  });
  const bucketPath = normalizeB2BucketPath(args.bucketPath ?? DEFAULT_B2_BUCKET_PATH);
  const credentialsFile = await prepareB2CredentialsFile(args.credentialsFile);
  const credentials = await readB2Credentials(credentialsFile);

  process.stdout.write(`Checking B2 bucket before backup: ${bucketName}\n`);
  const session = await authorizeB2(credentials);
  const bucket = await findB2Bucket(session, bucketName);

  if (!bucket) {
    throw new Error(`B2 bucket "${bucketName}" does not exist or this key cannot access it.`);
  }

  await ensureB2BucketPath(session, bucket, bucketPath);

  return {
    bucket,
    bucketName,
    bucketPath,
    credentials,
    removeZipAfterUpload: args.removeZipAfterUpload,
    target: "b2",
  };
}

async function resolveUploadTarget(target) {
  if (target) {
    return target;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("--upload requires a target when running non-interactively. Supported target: b2.");
  }

  return promptWithNewInterface("Upload target [b2]: ", {
    fallback: "b2",
    name: "upload target",
    required: true,
  });
}

async function resolveRequiredUploadValue(value, { name, prompt }) {
  if (value) {
    return validateRequired(value, name);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${name} is required when running non-interactively.`);
  }

  return promptWithNewInterface(prompt, {
    name,
    required: true,
  });
}

async function promptWithNewInterface(prompt, options) {
  const promptRl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return await promptForValue(promptRl, prompt, options);
  } finally {
    promptRl.close();
  }
}

async function prepareB2CredentialsFile(input) {
  const credentialsFile = expandHome(input ?? DEFAULT_B2_CREDENTIALS_FILE);
  const credentialsDir = dirname(credentialsFile);

  await mkdir(credentialsDir, { recursive: true });
  await chmod(credentialsDir, 0o700);

  if (!(await fileHasContent(credentialsFile))) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(
        `Backblaze B2 credentials not found at ${credentialsFile}. Run interactively once or create that file manually.`,
      );
    }

    process.stdout.write("Backblaze B2 credentials not found, or the credentials file is empty.\n");
    process.stdout.write("This needs a B2 application key ID and application key.\n");
    const applicationKeyId = await promptWithNewInterface("B2 application key ID: ", {
      name: "B2 application key ID",
      required: true,
    });
    const applicationKey = await promptHidden("Paste your B2 application key and press Enter: ");
    const normalizedKey = validateRequired(applicationKey, "B2 application key");

    await writeFile(
      credentialsFile,
      `${JSON.stringify(
        {
          applicationKey: normalizedKey,
          applicationKeyId,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  }

  await chmod(credentialsFile, 0o600);
  return credentialsFile;
}

async function readB2Credentials(credentialsFile) {
  let parsed;

  try {
    parsed = JSON.parse(await readFile(credentialsFile, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Backblaze B2 credentials file is not valid JSON: ${credentialsFile}`);
    }

    throw error;
  }

  return {
    applicationKey: validateRequired(parsed.applicationKey, "B2 application key"),
    applicationKeyId: validateRequired(parsed.applicationKeyId, "B2 application key ID"),
  };
}

async function fileHasContent(path) {
  try {
    const content = await readFile(path, "utf8");
    return /\S/.test(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function promptHidden(prompt) {
  return new Promise((resolvePrompt, rejectPrompt) => {
    const input = process.stdin;
    const output = process.stdout;
    let value = "";
    const wasRaw = input.isRaw;

    function cleanup() {
      input.off("data", onData);
      input.setRawMode(wasRaw);
      input.pause();
    }

    function onData(chunk) {
      const text = chunk.toString("utf8");

      for (const char of text) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          cleanup();
          output.write("\n");
          resolvePrompt(value);
          return;
        }

        if (char === "\u0003") {
          cleanup();
          output.write("\n");
          rejectPrompt(new Error("Input cancelled."));
          return;
        }

        if (char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }

        if (char >= " ") {
          value += char;
        }
      }
    }

    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    input.on("data", onData);
  });
}

async function runBackup(config) {
  const runDir = await realpathSafe(process.cwd());
  const zipDir = runDir && isPathInside(runDir, config.backupDir) ? homedir() : process.cwd();

  if (zipDir !== process.cwd()) {
    process.stdout.write("Current working directory is inside the backup directory.\n");
    process.stdout.write(`Saving the zip archive to: ${zipDir}\n`);
  }

  process.stdout.write(`Clearing existing contents from: ${config.backupDir}\n`);
  await clearDirectory(config.backupDir);
  await chmod(config.backupDir, 0o700);

  process.stdout.write("Starting GitHub backup...\n");
  process.stdout.write(`User: ${config.user}\n`);
  process.stdout.write(`Backup directory: ${config.backupDir}\n`);
  process.stdout.write("Release asset files are excluded. Release metadata is still included.\n");

  await runCommand("docker", dockerArgs(config), {
    failureMessage: "Docker backup command failed.",
  });

  const zipPath = await nextZipPath(zipDir);
  process.stdout.write("Creating zip archive at path:\n");
  process.stdout.write(`${zipPath}\n`);

  await runCommand("zip", ["-r", "-0", zipPath, basename(config.backupDir)], {
    cwd: dirname(config.backupDir),
    failureMessage: "Zip archive creation failed.",
  });

  const zipInfo = await stat(zipPath);
  let uploadResult = null;

  if (config.upload) {
    uploadResult = await uploadBackupArchive(config.upload, zipPath, zipInfo);

    if (config.upload.removeZipAfterUpload) {
      await rm(zipPath);
      process.stdout.write(`Removed local zip archive: ${displayPath(zipPath)}\n`);
    }
  }

  process.stdout.write("Done.\n");
  process.stdout.write(`Backup directory: ${config.backupDir}\n`);
  if (!config.upload?.removeZipAfterUpload) {
    process.stdout.write(`Zip archive: ${displayPath(zipPath)}\n`);
  }
  process.stdout.write(`Zip size: ${formatBytes(zipInfo.size)}\n`);
  if (uploadResult) {
    process.stdout.write(`B2 bucket: ${uploadResult.bucketName}\n`);
    process.stdout.write(`B2 path: ${uploadResult.fileName}\n`);
  }
}

function dockerArgs(config) {
  const containerName = `github-backup-${process.pid}-${Date.now().toString(36)}`;
  const userId = typeof process.getuid === "function" ? process.getuid() : 0;
  const groupId = typeof process.getgid === "function" ? process.getgid() : 0;
  const args = [
    "run",
    "--rm",
    "--user",
    `${userId}:${groupId}`,
    "--name",
    containerName,
    "-v",
    `${config.backupDir}:/data`,
    "-v",
    `${config.tokenFile}:/run/secrets/github_token:ro`,
    DOCKER_IMAGE,
    "-f",
    "file:///run/secrets/github_token",
    "-o",
    "/data",
    ...BACKUP_FLAGS,
  ];

  if (config.excludedRepos.length > 0) {
    args.push("--exclude", ...config.excludedRepos);
  }

  args.push("--", config.user);
  return args;
}

async function clearDirectory(path) {
  const entries = await readdir(path);
  await Promise.all(entries.map((entry) => rm(join(path, entry), { force: true, recursive: true })));
}

async function nextZipPath(zipDir) {
  const first = join(zipDir, `github-backup-${timestamp(false)}.zip`);

  if (!(await exists(first))) {
    return first;
  }

  return join(zipDir, `github-backup-${timestamp(true)}.zip`);
}

function timestamp(includeSeconds) {
  const now = new Date();
  const parts = [
    now.getDate(),
    now.getMonth() + 1,
    now.getFullYear(),
    now.getHours(),
    now.getMinutes(),
  ];

  if (includeSeconds) {
    parts.push(now.getSeconds());
  }

  return parts.map((part) => String(part).padStart(2, "0")).join("-");
}

function checkRuntimeDependencies() {
  checkCommand("docker", ["version"], {
    accessibleMessage:
      "Docker is required, but it is not accessible from this process. Ensure Docker is running and this user has permission to use it.",
    missingMessage:
      "Docker is required, but the docker command was not found in PATH. Install Docker and run this command again.",
  });

  checkCommand("zip", ["-v"], {
    accessibleMessage:
      "zip is required, but it is not accessible from this process. Ensure the zip command can run for this user.",
    missingMessage:
      "zip is required, but the zip command was not found in PATH. Install zip and run this command again.",
  });
}

function checkCommand(command, args, { accessibleMessage, missingMessage }) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error?.code === "ENOENT") {
    throw new Error(missingMessage);
  }

  if (result.error) {
    throw new Error(`${accessibleMessage}\n${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = commandFailureDetails(result);
    throw new Error(details ? `${accessibleMessage}\n${details}` : accessibleMessage);
  }
}

function commandFailureDetails(result) {
  return [result.stderr, result.stdout]
    .map((text) => text?.trim())
    .filter(Boolean)
    .join("\n")
    .split("\n")
    .slice(0, 4)
    .join("\n");
}

function runCommand(command, args, { cwd = process.cwd(), failureMessage }) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
    });

    child.on("error", rejectCommand);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }

      if (signal) {
        rejectCommand(new Error(`${failureMessage} Process terminated by ${signal}.`));
        return;
      }

      rejectCommand(new Error(`${failureMessage} Exit code ${code}.`));
    });
  });
}

async function uploadBackupArchive(uploadConfig, zipPath, zipInfo) {
  if (zipInfo.size > B2_MAX_SINGLE_UPLOAD_SIZE) {
    throw new Error(
      `B2 single-file upload supports files up to ${formatBytes(B2_MAX_SINGLE_UPLOAD_SIZE)}. The zip is ${formatBytes(zipInfo.size)}.`,
    );
  }

  const fileName = joinB2FileName(uploadConfig.bucketPath, basename(zipPath));

  process.stdout.write("Uploading zip archive to Backblaze B2...\n");
  process.stdout.write(`B2 bucket: ${uploadConfig.bucketName}\n`);
  process.stdout.write(`B2 path: ${fileName}\n`);

  const session = await authorizeB2(uploadConfig.credentials);
  const uploadUrl = await getB2UploadUrl(session, uploadConfig.bucket.bucketId);
  const contentSha1 = await sha1File(zipPath);
  const response = await fetch(uploadUrl.uploadUrl, {
    body: createReadStream(zipPath),
    duplex: "half",
    headers: {
      Authorization: uploadUrl.authorizationToken,
      "Content-Length": String(zipInfo.size),
      "Content-Type": "application/zip",
      "X-Bz-Content-Sha1": contentSha1,
      "X-Bz-File-Name": encodeB2FileName(fileName),
      "X-Bz-Info-src_last_modified_millis": String(Math.round(zipInfo.mtimeMs)),
    },
    method: "POST",
  });
  const result = await readB2Response(response, "B2 upload failed.");

  process.stdout.write(`B2 file ID: ${result.fileId}\n`);

  return {
    bucketName: uploadConfig.bucketName,
    fileName: result.fileName ?? fileName,
  };
}

async function authorizeB2(credentials) {
  ensureFetchAvailable();
  const auth = Buffer.from(
    `${credentials.applicationKeyId}:${credentials.applicationKey}`,
    "utf8",
  ).toString("base64");
  const response = await fetch(B2_AUTHORIZE_URL, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });
  const result = await readB2Response(response, "B2 authorization failed.");
  const storageApi = result.apiInfo?.storageApi ?? result;
  const apiUrl = storageApi.apiUrl;
  const authorizationToken = result.authorizationToken ?? storageApi.authorizationToken;

  if (!apiUrl || !authorizationToken || !result.accountId) {
    throw new Error("B2 authorization response did not include the expected API details.");
  }

  return {
    accountId: result.accountId,
    apiUrl,
    authorizationToken,
  };
}

async function findB2Bucket(session, bucketName) {
  const result = await b2JsonRequest(
    `${session.apiUrl}/b2api/v4/b2_list_buckets`,
    session.authorizationToken,
    {
      accountId: session.accountId,
      bucketName,
    },
    "B2 bucket check failed.",
  );

  return result.buckets?.find((bucket) => bucket.bucketName === bucketName) ?? null;
}

async function getB2UploadUrl(session, bucketId) {
  return b2JsonRequest(
    `${session.apiUrl}/b2api/v4/b2_get_upload_url`,
    session.authorizationToken,
    { bucketId },
    "B2 upload URL request failed.",
  );
}

async function ensureB2BucketPath(session, bucket, bucketPath) {
  if (!bucketPath) {
    return;
  }

  const markerName = joinB2FileName(bucketPath, ".keep");
  process.stdout.write(`Ensuring B2 bucket path exists: /${bucketPath}\n`);
  await uploadB2Bytes(session, bucket.bucketId, markerName, Buffer.alloc(0), {
    contentType: "application/octet-stream",
    failureMessage: "B2 bucket path creation failed.",
  });
}

async function uploadB2Bytes(
  session,
  bucketId,
  fileName,
  body,
  { contentType, failureMessage },
) {
  const uploadUrl = await getB2UploadUrl(session, bucketId);
  const response = await fetch(uploadUrl.uploadUrl, {
    body,
    headers: {
      Authorization: uploadUrl.authorizationToken,
      "Content-Length": String(body.length),
      "Content-Type": contentType,
      "X-Bz-Content-Sha1": createHash("sha1").update(body).digest("hex"),
      "X-Bz-File-Name": encodeB2FileName(fileName),
    },
    method: "POST",
  });

  return readB2Response(response, failureMessage);
}

async function b2JsonRequest(url, authorizationToken, body, failureMessage) {
  ensureFetchAvailable();
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      Authorization: authorizationToken,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return readB2Response(response, failureMessage);
}

async function readB2Response(response, failureMessage) {
  const text = await response.text();
  let body = null;

  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.trim() };
    }
  }

  if (!response.ok) {
    const details = body?.message || body?.code || response.statusText || "Unknown B2 error.";
    throw new Error(`${failureMessage} ${response.status} ${details}`);
  }

  return body ?? {};
}

function ensureFetchAvailable() {
  if (typeof fetch !== "function") {
    throw new Error("Backblaze B2 uploads require Node.js 18 or newer for built-in fetch.");
  }
}

function normalizeB2BucketPath(path) {
  const value = validateRequired(path, "B2 bucket path").replace(/\\/g, "/").trim();
  const normalized = value.replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized;
}

function joinB2FileName(bucketPath, fileName) {
  return [bucketPath, fileName].filter(Boolean).join("/");
}

function encodeB2FileName(fileName) {
  return fileName.split("/").map(encodeURIComponent).join("/");
}

function sha1File(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha1");
    const stream = createReadStream(path);

    stream.on("error", rejectHash);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function expandHome(path) {
  const value = String(path ?? "").trim();

  if (!value) {
    throw new Error("Path cannot be empty.");
  }

  if (value === "~") {
    return homedir();
  }

  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }

  return isAbsolute(value) ? value : resolve(value);
}

function displayPath(path) {
  const resolvedPath = resolve(path);
  const homePath = resolve(homedir());

  if (resolvedPath === homePath) {
    return "~";
  }

  if (isPathInside(resolvedPath, homePath)) {
    return `~/${relative(homePath, resolvedPath)}`;
  }

  return resolvedPath;
}

function isPathInside(childPath, parentPath) {
  const child = resolve(childPath);
  const parent = resolve(parentPath);
  const pathToChild = relative(parent, child);

  return pathToChild === "" || (!pathToChild.startsWith("..") && !isAbsolute(pathToChild));
}

async function realpathSafe(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)}${units[unitIndex]}`;
}

function unique(values) {
  return [...new Set(values)];
}

async function readPackageInfo() {
  const packageJsonPath = new URL("../package.json", import.meta.url);
  const rawPackageJson = await readFile(packageJsonPath, "utf8");
  return JSON.parse(rawPackageJson);
}

function helpText(packageInfo) {
  const command = packageInfo.name;
  const description = packageInfo.description || "";
  return `${command} ${packageInfo.version}
${description ? `\n${description}\n` : ""}
Usage:
  ${command} [options]

Examples:
  npx ${command}
  npx ${command} --user octocat --backup-dir ~/backups/github
  npx ${command} --user octocat --exclude repo1 repo2
  npx ${command} --user octocat --upload b2 --bucket backups --bucket-path /github
  npx ${command} --help
  npx ${command} --version

Options:
  -b, --backup-dir <path>           Backup directory. Defaults to ${DEFAULT_BACKUP_DIR}.
  -e, --exclude <repo...>           Repositories to exclude. Can be repeated.
  -h, --help                        Show this help text.
  -u, --user <username>             GitHub username to back up.
  -v, --version                     Show the package version.
  --upload [target]                 Upload target. Prompts when omitted. Supported target: b2.
  --bucket <name>                   Backblaze B2 bucket name. Prompts with --upload b2 when omitted.
  --bucket-path <path>              Backblaze B2 folder prefix. Defaults to ${DEFAULT_B2_BUCKET_PATH}.
  --b2-credentials-file <path>      Backblaze B2 credentials file. Defaults to ${DEFAULT_B2_CREDENTIALS_FILE}.
  --rm                              Remove the local zip after a successful upload.

Requirements:
  docker                            Must be installed, running, and usable by this user.
  zip                               Must be installed and usable by this user.

Token:
  This command needs a GitHub fine-grained personal access token.
  Create one at ${TOKEN_CREATE_URL}.
  Docs: ${TOKEN_DOCS_URL}.
  The token is stored at ${DEFAULT_TOKEN_FILE}.
  If it does not exist, you will be prompted for it and it will be saved for later runs.

Backblaze B2:
  B2 uploads use a stored application key ID and application key.
  The credentials are stored at ${DEFAULT_B2_CREDENTIALS_FILE}.
  If they do not exist, you will be prompted for them and they will be saved for later runs.
  The B2 bucket is checked before the GitHub backup starts.
  The B2 bucket path is created before the GitHub backup starts.
`;
}

main();
