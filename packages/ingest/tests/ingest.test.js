import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ingestPath } from "../src/ingest.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../bin/ingest.js", import.meta.url));

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ingest-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "src", "nested"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "left-pad"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, ".next"), { recursive: true });
  await mkdir(path.join(root, ".firecrawl"), { recursive: true });
  await writeFile(path.join(root, "README.md"), "# Fixture\n", "utf8");
  await writeFile(path.join(root, "src", "index.js"), "console.log('hello');\n", "utf8");
  await writeFile(path.join(root, "src", "main.ts"), "export const main = true;\n", "utf8");
  await writeFile(path.join(root, "src", "nested", "deep.ts"), "export const deep = true;\n", "utf8");
  await writeFile(path.join(root, "node_modules", "left-pad", "index.js"), "module.exports = () => {};\n", "utf8");
  await writeFile(path.join(root, ".git", "config"), "[core]\n", "utf8");
  await writeFile(path.join(root, ".next", "build-manifest.json"), "{}\n", "utf8");
  await writeFile(path.join(root, ".firecrawl", "search.md"), "junk from web searches\n", "utf8");
  await writeFile(path.join(root, ".gitignore"), "ignored.txt\nnode_modules\n", "utf8");
  await writeFile(path.join(root, ".customignore"), "src/index.js\n", "utf8");
  await writeFile(path.join(root, "ignored.txt"), "ignored\n", "utf8");
  return root;
}

async function createAllFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ingest-all-"));
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await mkdir(path.join(root, ".firecrawl"), { recursive: true });

  await writeFile(path.join(root, ".gitignore"), "ignored.txt\n", "utf8");
  await writeFile(path.join(root, "ignored.txt"), "ignored\n", "utf8");
  await writeFile(path.join(root, ".env"), "SECRET=value\n", "utf8");
  await writeFile(path.join(root, "node_modules", "pkg", "index.js"), "module.exports = true;\n", "utf8");
  await writeFile(path.join(root, ".git", "config"), "[core]\n", "utf8");
  await writeFile(path.join(root, ".firecrawl", "search.md"), "junk from web searches\n", "utf8");
  await writeFile(path.join(root, "document.pdf"), "%PDF-1.1\nnot a complete pdf\n", "utf8");
  await writeFile(
    path.join(root, "notebook.ipynb"),
    JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { display_name: "Python 3" }, language_info: { name: "python" } },
      cells: [{ cell_type: "markdown", source: ["# Notebook\n"], metadata: {} }],
    }),
    "utf8",
  );

  return root;
}

describe("ingestPath", () => {
  test("creates a gitingest-style digest with summary, tree, and file sections", async () => {
    const root = await createFixture();
    const result = await ingestPath(root);
    const resolvedRoot = await realpath(root);

    assert.ok(result.summary.includes("Files analyzed: 5"));
    assert.ok(result.summary.includes("Stats: 14 words, 5 lines"));
    assert.ok(result.summary.includes(`Path: ${resolvedRoot}`));
    assert.ok(result.summary.includes("Excluded directories: .firecrawl, .git, .next, node_modules"));
    assert.ok(!result.summary.includes("Estimated tokens"));
    assert.ok(!result.digest.includes("Estimated tokens"));
    assert.ok(result.tree.includes("Directory structure:"));
    assert.ok(result.tree.includes("README.md"));
    assert.ok(result.tree.includes("src/"));
    assert.ok(result.content.includes("FILE: README.md"));
    assert.ok(result.content.includes("FILE: src/index.js"));
    assert.ok(result.content.includes("FILE: src/main.ts"));
    assert.ok(result.content.includes("FILE: src/nested/deep.ts"));
    assert.ok(!result.content.includes("FILE: .firecrawl/search.md"));
    assert.ok(result.digest.includes("================================================"));
  });

  test("applies user exclude patterns", async () => {
    const root = await createFixture();
    const result = await ingestPath(root, { exclude: ["*.js"] });

    assert.ok(result.summary.includes("Files analyzed: 4"));
    assert.ok(result.content.includes("FILE: README.md"));
    assert.ok(!result.content.includes("FILE: src/index.js"));
  });

  test("applies include patterns while traversing directories", async () => {
    const root = await createFixture();
    const result = await ingestPath(root, { include: ["src/**/*.ts", "README.md"] });

    assert.ok(result.summary.includes("Files analyzed: 3"));
    assert.ok(result.content.includes("FILE: README.md"));
    assert.ok(result.content.includes("FILE: src/main.ts"));
    assert.ok(result.content.includes("FILE: src/nested/deep.ts"));
    assert.ok(!result.content.includes("FILE: src/index.js"));
  });

  test("applies the nextjs exclusion template", async () => {
    const root = await createFixture();
    const result = await ingestPath(root, { includeDangerous: true, templates: ["nextjs"] });

    assert.ok(result.excludedDirectories.includes(".next"));
    assert.ok(!result.excludedDirectories.includes("node_modules"));
    assert.ok(result.content.includes(".firecrawl/search.md"));
    assert.ok(result.content.includes("node_modules/left-pad/index.js"));
    assert.ok(!result.content.includes(".next/build-manifest.json"));
  });

  test("loads additional ignore file names", async () => {
    const root = await createFixture();
    const result = await ingestPath(root, { ignoreFiles: [".gitignore", ".gitingestignore", ".customignore"] });

    assert.ok(!result.content.includes("FILE: src/index.js"));
    assert.ok(result.content.includes("FILE: src/main.ts"));
  });

  test("CLI --all enables every special include option", async () => {
    const root = await createAllFixture();

    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, root, "--all", "--stdout"], {
      maxBuffer: 1024 * 1024,
    });

    assert.equal(stderr, "Running with: --include-dangerous, --include-gitignored, --include-pdf, --include-env, --ipynb\n");
    assert.ok(stdout.includes("FILE: ignored.txt"));
    assert.ok(stdout.includes("FILE: .env"));
    assert.ok(stdout.includes("FILE: node_modules/pkg/index.js"));
    assert.ok(stdout.includes("FILE: .git/config"));
    assert.ok(stdout.includes("FILE: .firecrawl/search.md"));
    assert.ok(stdout.includes("FILE: document.pdf"));
    assert.ok(stdout.includes("[PDF text extraction failed:"));
    assert.ok(stdout.includes("[Jupyter Notebook]"));
    assert.ok(stdout.includes("[cell 1] markdown"));
  });

  test("CLI --all exclusion flags subtract from the enabled all options", async () => {
    const root = await createAllFixture();

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [CLI_PATH, root, "--all", "--exclude-gitignored", "--exclude-env", "--stdout"],
      { maxBuffer: 1024 * 1024 },
    );

    assert.equal(stderr, "Running with: --include-dangerous, --include-pdf, --ipynb\n");
    assert.ok(!stdout.includes("FILE: ignored.txt"));
    assert.ok(!stdout.includes("FILE: .env"));
    assert.ok(stdout.includes("FILE: node_modules/pkg/index.js"));
    assert.ok(stdout.includes("FILE: .git/config"));
    assert.ok(stdout.includes("FILE: document.pdf"));
    assert.ok(stdout.includes("[Jupyter Notebook]"));
  });
});
