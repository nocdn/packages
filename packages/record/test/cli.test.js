import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

// Recording itself is macOS only (the CLI refuses to start elsewhere), so the
// tests that drive a fake native helper through a recording only run on macOS.
const macOSOnly = { skip: process.platform !== "darwin" && "requires macOS" };

const cliPath = fileURLToPath(new URL("../bin/cli.js", import.meta.url));
const packageInfo = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

function run(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
  });
}

test("help is generated from package metadata and lists recorder options", () => {
  const result = run("--help");

  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    new RegExp(`${packageInfo.name} ${packageInfo.version}`),
  );
  assert.match(result.stdout, /--output <path>/);
  assert.match(result.stdout, /--no-mic/);
  assert.match(result.stdout, /--only-mic/);
  assert.match(result.stdout, /--list-mics/);
  assert.match(result.stdout, /mics/);
  assert.match(result.stdout, /permissions/);
  assert.match(result.stdout, /default: 60/);
  assert.match(result.stdout, /MP3/);
  assert.match(result.stdout, /Ctrl\+D/);
  assert.match(result.stdout, /Esc/);
  assert.match(result.stdout, /--window/);
  assert.match(result.stdout, /--region/);
  assert.match(result.stdout, /--for/);
  assert.match(result.stdout, /--only-system-audio/);
  assert.match(result.stdout, /--only-audio/);
  assert.match(result.stdout, /--audio-only/);
  assert.match(result.stdout, /--separate-audio-tracks/);
  assert.match(result.stdout, /--internal/);
  assert.match(result.stdout, /--internal-only/);
  assert.match(result.stdout, /--only-camera/);
  assert.match(result.stdout, /--hevc/);
  assert.match(result.stdout, /--quality/);
  assert.match(result.stdout, /--here/);
  assert.match(result.stdout, /--location/);
  assert.match(result.stdout, /--camera-only/);
  assert.match(result.stdout, /--duration/);
  assert.match(result.stdout, /--delay/);
  assert.match(result.stdout, /--app/);
  assert.match(result.stdout, /Downloads/);
  assert.match(result.stdout, /Enter/);
});

test("version prints the package version", () => {
  const result = run("--version");

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${packageInfo.version}\n`);
});

test("unknown flags fail with a help hint", () => {
  const result = run("--unknown");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option/);
  assert.match(result.stderr, /--help/);
});

test("invalid recording values fail before launching the native helper", () => {
  const result = run("--fps", "0");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--fps must be greater than 0/);
});

test("duration and region flags are validated", () => {
  assert.match(run("--for", "0").stderr, /--for must be greater than 0/);
  assert.match(run("--in", "nope").stderr, /--in must look like/);
  assert.match(run("--region", "1,2").stderr, /x,y,w,h/);
  assert.match(run("--quality", "ultra").stderr, /low/);
  assert.match(
    run("--only-mic", "--camera").stderr,
    /cannot be combined with --camera/,
  );
  assert.match(
    run("--window", "Safari", "--region").stderr,
    /either --window or --region/,
  );
});

test("only-mic cannot be combined with no-mic", () => {
  const result = run("--only-mic", "--no-mic");

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /--only-mic option cannot be combined with --no-mic/,
  );
});

test("internal is an alias for only-system-audio", () => {
  assert.match(
    run("--internal", "--no-system-audio").stderr,
    /--only-system-audio option cannot be combined with --no-system-audio/,
  );
  assert.match(
    run("--internal-only", "--only-mic").stderr,
    /Choose only one of/,
  );
  assert.match(
    run("--system-audio-only", "--only-camera").stderr,
    /Choose only one of/,
  );
});

test("audio-only combines system and microphone audio", () => {
  assert.match(
    run("--only-audio", "--no-mic").stderr,
    /--only-audio option cannot be combined/,
  );
  assert.match(
    run("--audio-only", "--no-system-audio").stderr,
    /--only-audio option cannot be combined/,
  );
  assert.match(run("--only-audio", "--only-mic").stderr, /Choose only one of/);
  assert.match(
    run("--only-audio", "--camera").stderr,
    /cannot be combined with --camera/,
  );
});

test("separate audio tracks require both sources and a multi-track container", () => {
  assert.match(
    run("--separate-audio-tracks", "--no-mic").stderr,
    /requires both microphone and system audio/,
  );
  assert.match(
    run("--separate-audio-tracks", "--no-system-audio").stderr,
    /requires both microphone and system audio/,
  );
  assert.match(
    run("--only-audio", "--separate-audio-tracks", "-o", "recording.mp3")
      .stderr,
    /must use \.mov, \.mp4, \.m4a/,
  );
  assert.match(
    run("--only-camera", "--separate-audio-tracks").stderr,
    /cannot be combined with --only-camera/,
  );
});

test(
  "separate audio-only defaults to MOV and reaches the native helper",
  macOSOnly,
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "record-tracks-"));
    const helper = path.join(directory, "fake-native.js");
    await writeFile(
      helper,
      `#!/usr/bin/env node
const outputIndex = process.argv.indexOf("--output");
if (!process.argv.includes("--only-audio") || !process.argv.includes("--separate-audio-tracks")) {
  process.stderr.write("missing multi-track native flags\\n");
  process.exit(1);
}
const output = process.argv[outputIndex + 1];
process.stdout.write(JSON.stringify({ event: "started", path: output }) + "\\n");
process.stdout.write(JSON.stringify({ event: "saved", path: output }) + "\\n");
`,
    );
    await chmod(helper, 0o755);

    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "--only-audio",
        "--separate-audio-tracks",
        "--location",
        directory,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, RECORD_NATIVE: helper },
      },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Saved: .*\.mov/);
  },
);

test("common-sense aliases map to the canonical flags", () => {
  assert.match(run("--camera-only", "--only-mic").stderr, /Choose only one of/);
  assert.match(run("--duration", "0").stderr, /must be greater than 0/);
  assert.match(run("--delay", "nope").stderr, /must look like/);
  assert.match(
    run("--app", "Safari", "--region").stderr,
    /either --window or --region/,
  );
});

test("recording header lists the active sources", macOSOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "record-sources-"));
  const helper = path.join(directory, "fake-native.js");
  await writeFile(
    helper,
    `#!/usr/bin/env node
const output = process.argv[process.argv.indexOf("--output") + 1];
process.stdout.write(JSON.stringify({ event: "started", path: output }) + "\\n");
process.stdout.write(JSON.stringify({ event: "saved", path: output }) + "\\n");
`,
  );
  await chmod(helper, 0o755);

  const microphone = spawnSync(process.execPath, [cliPath, "--only-mic"], {
    encoding: "utf8",
    env: { ...process.env, RECORD_NATIVE: helper },
  });
  const microphoneAndScreen = spawnSync(
    process.execPath,
    [cliPath, "--no-system-audio"],
    {
      encoding: "utf8",
      env: { ...process.env, RECORD_NATIVE: helper },
    },
  );

  assert.equal(microphone.status, 0);
  assert.match(microphone.stdout, /Recording \[microphone\]/);
  assert.equal(microphoneAndScreen.status, 0);
  assert.match(microphoneAndScreen.stdout, /Recording \[microphone, screen\]/);
});

test("only one output destination is allowed", () => {
  assert.match(
    run("--here", "-o", "out.mp4").stderr,
    /Choose only one of --output, --location, or --here/,
  );
  assert.match(
    run("--location", os.tmpdir(), "--here").stderr,
    /Choose only one of --output, --location, or --here/,
  );
  assert.match(
    run("--location", os.tmpdir(), "-o", "out.mp4").stderr,
    /Choose only one of --output, --location, or --here/,
  );
});

test("SIGINT tells a fake helper to stop and save", macOSOnly, async () => {
  const helper = await writeFakeHelper();
  const output = path.join(os.tmpdir(), `record-save-${process.pid}.mp3`);
  const child = spawn(process.execPath, [cliPath, "--only-mic", "-o", output], {
    env: { ...process.env, RECORD_NATIVE: helper },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = await waitForOutput(child, "stop and save");
  child.kill("SIGINT");
  const [code, rest] = await waitForClose(child);

  assert.equal(code, 0);
  assert.match(stdout + rest, /Saved:/);
  assert.match(stdout + rest, /or Ctrl\+D or Esc to discard/);
  assert.match(stdout + rest, /Recording \[microphone\]/);
  assert.doesNotMatch(stdout + rest, /[◴◷◶◵]/);
  assert.doesNotMatch(stdout + rest, /●/);
  assert.doesNotMatch(stdout + rest, /System:.*\[/);
  assert.match(stdout + rest, /Mic: \[████████████████▓-------\] -18 dB/);
  assert.doesNotMatch(stdout + rest, /#/);
  assert.doesNotMatch(stdout + rest, /Mic:  +\[/);
  assert.doesNotMatch(stdout + rest, /Duration: 00:00:00/);
  assert.doesNotMatch(stdout + rest, /Discarded/);
});

async function writeFakeHelper() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "record-fake-"));
  const helperPath = path.join(directory, "fake-native.js");
  await writeFile(
    helperPath,
    `#!/usr/bin/env node
import { createInterface } from "node:readline";

const output = process.argv[process.argv.indexOf("--output") + 1];
process.stdout.write(JSON.stringify({ event: "started", path: output }) + "\\n");
const progress = {
  event: "progress",
  duration: 12,
};
if (process.argv.includes("--only-mic")) {
  progress.microphoneLevel = -18;
} else {
  progress.systemLevel = -30;
  progress.microphoneLevel = -18;
}
process.stdout.write(JSON.stringify(progress) + "\\n");

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (line.includes('"discard"')) {
    process.stdout.write(JSON.stringify({ event: "discarded", path: output }) + "\\n");
    process.exit(0);
  }
  if (line.includes('"stop"')) {
    process.stdout.write(JSON.stringify({ event: "saved", path: output }) + "\\n");
    process.exit(0);
  }
});
`,
  );
  await chmod(helperPath, 0o755);
  return helperPath;
}

function waitForOutput(child, snippet) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const onData = (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes(snippet)) {
        child.stdout.off("data", onData);
        resolve(stdout);
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("close", (code) => {
      reject(new Error(`helper exited before ${snippet}: ${code}\n${stdout}`));
    });
  });
}

function waitForClose(child) {
  return new Promise((resolve, reject) => {
    let rest = "";
    child.stdout.on("data", (chunk) => {
      rest += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => resolve([code, rest]));
  });
}
