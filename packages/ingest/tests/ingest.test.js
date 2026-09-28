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
const SIMPLE_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 44 >>
stream
BT /F1 24 Tf 72 720 Td (Hello LiteParse PDF) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000241 00000 n 
0000000311 00000 n 
trailer
<< /Root 1 0 R /Size 6 >>
startxref
405
%%EOF
`;

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
  await writeFile(path.join(root, "document.pdf"), SIMPLE_PDF, "utf8");
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

  test("returns raw content without a file header for a single file", async () => {
    const root = await createFixture();
    const result = await ingestPath(path.join(root, "README.md"));

    assert.equal(result.content, "# Fixture\n");
    assert.equal(result.digest, "# Fixture\n\n");
    assert.ok(!result.content.includes("FILE: README.md"));
    assert.ok(result.summary.includes("File: README.md"));
    assert.equal(result.tree, "");
  });

  test("includes PDF files by default using LiteParse", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ingest-pdf-"));
    await writeFile(path.join(root, "README.md"), "# Fixture\n", "utf8");
    await writeFile(path.join(root, "document.pdf"), SIMPLE_PDF, "utf8");

    const result = await ingestPath(root);

    assert.ok(result.content.includes("FILE: document.pdf"));
    assert.ok(result.content.includes("[PDF document - 1 page parsed by LiteParse]"));
    assert.ok(result.content.includes("Hello LiteParse PDF"));
  });

  test("excludes PDF files when explicitly requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ingest-pdf-exclude-"));
    await writeFile(path.join(root, "README.md"), "# Fixture\n", "utf8");
    await writeFile(path.join(root, "document.pdf"), SIMPLE_PDF, "utf8");

    const result = await ingestPath(root, { includePdf: false });

    assert.ok(result.content.includes("FILE: README.md"));
    assert.ok(!result.content.includes("FILE: document.pdf"));
  });

  test("CLI --all enables every special include option", async () => {
    const root = await createAllFixture();

    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, root, "--all", "--stdout"], {
      maxBuffer: 1024 * 1024,
    });

    assert.equal(stderr, "Running with: --include-dangerous, --include-gitignored, --include-env, --ipynb\n");
    assert.ok(stdout.includes("FILE: ignored.txt"));
    assert.ok(stdout.includes("FILE: .env"));
    assert.ok(stdout.includes("FILE: node_modules/pkg/index.js"));
    assert.ok(stdout.includes("FILE: .git/config"));
    assert.ok(stdout.includes("FILE: .firecrawl/search.md"));
    assert.ok(stdout.includes("FILE: document.pdf"));
    assert.ok(stdout.includes("Hello LiteParse PDF"));
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

    assert.equal(stderr, "Running with: --include-dangerous, --ipynb\n");
    assert.ok(!stdout.includes("FILE: ignored.txt"));
    assert.ok(!stdout.includes("FILE: .env"));
    assert.ok(stdout.includes("FILE: node_modules/pkg/index.js"));
    assert.ok(stdout.includes("FILE: .git/config"));
    assert.ok(stdout.includes("FILE: document.pdf"));
    assert.ok(stdout.includes("[Jupyter Notebook]"));
  });

  test("CLI excludes PDFs with --exclude-pdf or --exclude PDF", async () => {
    const root = await createAllFixture();

    const excludedByFlag = await execFileAsync(process.execPath, [CLI_PATH, root, "--all", "--exclude-pdf", "--stdout"], {
      maxBuffer: 1024 * 1024,
    });
    const excludedByPattern = await execFileAsync(process.execPath, [CLI_PATH, root, "--all", "--exclude", "PDF", "--stdout"], {
      maxBuffer: 1024 * 1024,
    });

    assert.ok(!excludedByFlag.stdout.includes("FILE: document.pdf"));
    assert.ok(!excludedByPattern.stdout.includes("FILE: document.pdf"));
  });

  test("CLI rejects invalid --repo URLs", async () => {
    await assert.rejects(
      () => execFileAsync(process.execPath, [CLI_PATH, "--repo", "not-a-url", "--stdout"]),
      (error) => {
        assert.match(String(error.stderr), /Invalid repository URL: "not-a-url"/);
        return true;
      },
    );
  });

  test("CLI accepts GitHub --repo URLs with a trailing slash", async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      CLI_PATH,
      "--repo",
      "https://github.com/nocdn/ingest/",
      "--version",
    ]);

    assert.equal(stderr, "");
    assert.match(stdout, /^\d+\.\d+\.\d+\n$/);
  });
});
