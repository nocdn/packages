#!/usr/bin/env node
// Packs every publishable workspace, installs the tarballs into an empty
// project the way `npx` would (dependencies come from the registry, not the
// workspace), and runs each command. This catches files missing from `files`,
// dependencies used but not declared, and broken bin entries before a release.
//
// Usage: node scripts/smoke.js [package-dir-name ...]
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const only = new Set(process.argv.slice(2));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32" && command === npm,
    ...options,
  });
}

function workspacePackages() {
  const packagesDir = path.join(repoRoot, "packages");
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(packagesDir, entry.name);
      const manifest = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      );
      return { dirName: entry.name, dir, manifest };
    })
    .filter(({ manifest }) => !manifest.private)
    .filter(({ dirName }) => only.size === 0 || only.has(dirName));
}

function supportsThisPlatform(manifest) {
  const allowed = manifest.os;
  return !allowed || allowed.includes(process.platform);
}

function trackedFiles(dir) {
  return run("git", ["ls-files", "-z"], { cwd: dir })
    .split("\0")
    .filter(Boolean);
}

function assertTemplatesArePacked(pkg, packedFiles) {
  // create-nocdn-app copies its bundled templates, so every tracked template
  // file has to be in the tarball. npm never packs .gitignore/.npmignore, which
  // is why templates store those files without the leading dot.
  const missing = trackedFiles(pkg.dir)
    .filter((file) => file.startsWith("templates/"))
    .filter((file) => !packedFiles.has(file));
  if (missing.length > 0) {
    throw new Error(
      `${pkg.manifest.name} tarball is missing template files:\n  ${missing.join("\n  ")}`,
    );
  }
}

async function main() {
  const packages = workspacePackages();
  const work = await mkdtemp(path.join(os.tmpdir(), "nocdn-smoke-"));
  const failures = [];

  try {
    const tarballs = [];
    for (const pkg of packages) {
      if (!supportsThisPlatform(pkg.manifest)) {
        console.log(`- ${pkg.manifest.name}: skipped on ${process.platform}`);
        continue;
      }

      // --ignore-scripts keeps record's prepack from building the native
      // helper here; the record workflow builds and signs it for real.
      const [packed] = JSON.parse(
        run(
          npm,
          [
            "pack",
            "--json",
            "--ignore-scripts",
            "--pack-destination",
            work,
            "--workspace",
            pkg.dir,
          ],
          { cwd: repoRoot },
        ),
      );
      const packedFiles = new Set(packed.files.map((file) => file.path));
      for (const required of ["package.json", "README.md", "LICENSE"]) {
        if (!packedFiles.has(required)) {
          failures.push(`${pkg.manifest.name}: tarball is missing ${required}`);
        }
      }
      if (pkg.dirName === "create-nocdn-app") {
        assertTemplatesArePacked(pkg, packedFiles);
      }
      tarballs.push({ pkg, file: path.join(work, packed.filename) });
    }

    const project = path.join(work, "project");
    run("mkdir", ["-p", project]);
    await writeFile(
      path.join(project, "package.json"),
      `${JSON.stringify({ name: "smoke", private: true }, null, 2)}\n`,
    );
    run(
      npm,
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        ...tarballs.map(({ file }) => file),
      ],
      { cwd: project },
    );

    for (const { pkg } of tarballs) {
      for (const bin of Object.keys(pkg.manifest.bin ?? {})) {
        const binPath = path.join(project, "node_modules", ".bin", bin);
        const label = `${pkg.manifest.name} (${bin})`;
        try {
          const version = run(binPath, ["--version"]);
          if (!version.includes(pkg.manifest.version)) {
            throw new Error(
              `--version printed ${JSON.stringify(version.trim())}`,
            );
          }
          run(binPath, ["--help"]);
          console.log(`✓ ${label}`);
        } catch (error) {
          failures.push(`${label}: ${error.stderr || error.message}`);
        }
      }
    }

    const scaffold = path.join(project, "node_modules", ".bin", "create-nocdn-app");
    if (existsSync(scaffold)) {
      for (const template of ["next", "vite", "tanstack", "hono"]) {
        const cwd = await mkdtemp(path.join(work, `scaffold-${template}-`));
        try {
          run(
            scaffold,
            ["app", "-t", template, "--skip-install", "--skip-git", "--no-agents"],
            { cwd },
          );
          if (!existsSync(path.join(cwd, "app", ".gitignore"))) {
            throw new Error(".gitignore was not created");
          }
          console.log(`✓ create-nocdn-app scaffolds ${template}`);
        } catch (error) {
          failures.push(
            `create-nocdn-app ${template}: ${error.stderr || error.message}`,
          );
        }
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\nSmoke test failed:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
  }
}

await main();
