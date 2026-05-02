import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { ingestPath } from "../src/ingest.js";

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "repo-squeeze-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "src", "nested"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "left-pad"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, ".next"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# Fixture\n", "utf8");
  await writeFile(path.join(root, "src", "index.js"), "console.log('hello');\n", "utf8");
  await writeFile(path.join(root, "src", "main.ts"), "export const main = true;\n", "utf8");
  await writeFile(path.join(root, "src", "nested", "deep.ts"), "export const deep = true;\n", "utf8");
  await writeFile(path.join(root, "node_modules", "left-pad", "index.js"), "module.exports = () => {};\n", "utf8");
  await writeFile(path.join(root, ".git", "config"), "[core]\n", "utf8");
  await writeFile(path.join(root, ".next", "build-manifest.json"), "{}\n", "utf8");
  await writeFile(path.join(root, ".gitignore"), "ignored.txt\nnode_modules\n", "utf8");
  await writeFile(path.join(root, ".customignore"), "src/index.js\n", "utf8");
  await writeFile(path.join(root, "ignored.txt"), "ignored\n", "utf8");
  return root;
}

describe("ingestPath", () => {
  test("creates a gitingest-style digest with summary, tree, and file sections", async () => {
    const root = await createFixture();
    const result = await ingestPath(root);
    const resolvedRoot = await realpath(root);

    expect(result.summary).toContain("Files analyzed: 5");
    expect(result.summary).toContain(`Path: ${resolvedRoot}`);
    expect(result.summary).toContain("Excluded directories: .git, .next, node_modules");
    expect(result.summary).not.toContain("Estimated tokens");
    expect(result.digest).not.toContain("Estimated tokens");
    expect(result.tree).toContain("Directory structure:");
    expect(result.tree).toContain("README.md");
    expect(result.tree).toContain("src/");
    expect(result.content).toContain("FILE: README.md");
    expect(result.content).toContain("FILE: src/index.js");
    expect(result.content).toContain("FILE: src/main.ts");
    expect(result.content).toContain("FILE: src/nested/deep.ts");
    expect(result.digest).toContain("================================================");
  });

  test("applies user exclude patterns", async () => {
    const root = await createFixture();
    const result = await ingestPath(root, { exclude: ["*.js"] });

    expect(result.summary).toContain("Files analyzed: 4");
    expect(result.content).toContain("FILE: README.md");
    expect(result.content).not.toContain("FILE: src/index.js");
  });

  test("applies include patterns while traversing directories", async () => {
    const root = await createFixture();
    const result = await ingestPath(root, { include: ["src/**/*.ts", "README.md"] });

    expect(result.summary).toContain("Files analyzed: 3");
    expect(result.content).toContain("FILE: README.md");
    expect(result.content).toContain("FILE: src/main.ts");
    expect(result.content).toContain("FILE: src/nested/deep.ts");
    expect(result.content).not.toContain("FILE: src/index.js");
  });

  test("applies the nextjs exclusion template", async () => {
    const root = await createFixture();
    const result = await ingestPath(root, { includeDangerous: true, templates: ["nextjs"] });

    expect(result.excludedDirectories).toContain(".next");
    expect(result.excludedDirectories).not.toContain("node_modules");
    expect(result.content).toContain("node_modules/left-pad/index.js");
    expect(result.content).not.toContain(".next/build-manifest.json");
  });

  test("loads additional ignore file names", async () => {
    const root = await createFixture();
    const result = await ingestPath(root, { ignoreFiles: [".gitignore", ".gitingestignore", ".customignore"] });

    expect(result.content).not.toContain("FILE: src/index.js");
    expect(result.content).toContain("FILE: src/main.ts");
  });
});
