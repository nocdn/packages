import { lstat, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import {
  BUILT_IN_EXCLUDE_PATTERNS,
  TEMPLATE_PATTERNS,
  createIncludeMatcher,
  createPatternMatcher,
  isDangerousIgnorePattern,
  parseIgnoreFile,
  parsePatterns,
} from "./patterns.js";

const SEPARATOR = "=".repeat(48);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 10_000;
const MAX_TOTAL_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_DIRECTORY_DEPTH = 20;
const SAMPLE_SIZE = 8192;
const PDF_EXCLUDE_PATTERNS = ["*.pdf"];

let liteParseParserPromise;

export async function ingestPath(source = ".", options = {}) {
  const startTime = performance.now();
  const cwd = options.cwd ?? process.cwd();
  const rootPath = path.resolve(cwd, source || ".");
  const rootStats = await lstat(rootPath);
  const resolvedRoot = await realpath(rootPath);
  const rootName = path.basename(rootPath) || rootPath;
  const ignoreFileNames = options.ignoreFiles ?? [".gitignore", ".gitingestignore"];
  const loadedIgnorePatterns = options.includeGitignored ? [] : await loadIgnorePatterns(rootPath, ignoreFileNames);
  const ignoreFilePatterns = options.includeDangerous
    ? loadedIgnorePatterns.filter((pattern) => !isDangerousIgnorePattern(pattern))
    : loadedIgnorePatterns;
  const rawTemplatePatterns = collectTemplatePatterns(options.templates ?? []);
  const userExcludePatterns = parsePatterns(options.exclude ?? []).map(normalizePdfExcludePattern);
  const includePdf = options.includePdf ?? true;
  const rawBuiltInPatterns = options.includeDangerous
    ? []
    : filterPdfPattern(BUILT_IN_EXCLUDE_PATTERNS, includePdf);
  const builtInPatterns = options.includeEnv ? filterEnvPatterns(rawBuiltInPatterns) : rawBuiltInPatterns;
  const templatePatterns = options.includeEnv ? filterEnvPatterns(rawTemplatePatterns) : rawTemplatePatterns;
  const pdfExcludePatterns = includePdf ? [] : PDF_EXCLUDE_PATTERNS;
  const excludePatterns = [
    ...builtInPatterns,
    ...ignoreFilePatterns,
    ...templatePatterns,
    ...pdfExcludePatterns,
    ...userExcludePatterns,
  ];
  const shouldExclude = createPatternMatcher(excludePatterns);
  const shouldInclude = createIncludeMatcher(options.include ?? []);
  const state = {
    rootPath,
    resolvedRoot,
    maxFileSize: options.maxFileSize ?? MAX_FILE_SIZE,
    verbose: options.verbose ?? false,
    lineNumbers: options.lineNumbers ?? false,
    dryRun: options.dryRun ?? false,
    convertIpynb: options.ipynb ?? false,
    filesAnalyzed: 0,
    totalSize: 0,
    totalWords: 0,
    totalLines: 0,
    excludedDirectories: new Set(),
  };

  const isRootFile = !rootStats.isDirectory();

  const rootNode = isRootFile
    ? await processRootFile(rootPath, rootName, path.basename(rootPath), shouldExclude, shouldInclude, state, includePdf)
    : await processDirectory(rootPath, rootName, "", 0, shouldExclude, shouldInclude, state, includePdf);

  if (!rootNode) {
    throw new Error("No files were available to ingest after exclusions were applied.");
  }

  let summary;
  let tree;
  let content;
  let digest;

  if (isRootFile) {
    tree = "";
    content = renderSingleFileContent(rootNode, state.lineNumbers);
    summary = createFileSummary({
      relativePath: rootNode.relativePath,
      resolvedRoot,
      size: rootNode.size ?? 0,
    });
    digest = `${content}\n`;
  } else {
    tree = `Directory structure:\n${createTree(rootNode)}`;
    content = gatherFileContents(rootNode, state.lineNumbers).trimEnd();
    summary = createSummary({
      rootName,
      resolvedRoot,
      filesAnalyzed: state.filesAnalyzed,
      totalWords: state.totalWords,
      totalLines: state.totalLines,
      includeStats: !state.dryRun,
      excludedDirectories: state.excludedDirectories,
    });
    digest = `${summary}\n\n${tree}\n\n${content}\n`;
  }

  if (state.verbose) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    summary += `\nElapsed: ${elapsed}s`;
  }

  return {
    summary,
    tree,
    content,
    digest,
    filesAnalyzed: state.filesAnalyzed,
    totalWords: state.totalWords,
    totalLines: state.totalLines,
    excludedDirectories: [...state.excludedDirectories].sort(),
    files: collectFileList(rootNode),
    totalSize: state.totalSize,
    path: resolvedRoot,
    isFile: isRootFile,
  };
}

function renderSingleFileContent(node, lineNumbers) {
  return lineNumbers && node.type === "file" ? addLineNumbers(node.content) : node.content;
}

function createFileSummary({ relativePath, resolvedRoot, size }) {
  return [
    `File: ${relativePath}`,
    `Path: ${resolvedRoot}`,
    `Size: ${size.toLocaleString("en-US")} bytes`,
  ].join("\n");
}

function collectFileList(node) {
  const files = [];
  const walk = (current) => {
    if (current.type === "directory") {
      current.children.forEach(walk);
      return;
    }
    files.push({ relativePath: current.relativePath, type: current.type, size: current.size ?? 0 });
  };
  walk(node);
  return files;
}

export async function writeDigest(outputPath, digest, cwd = process.cwd()) {
  const target = path.resolve(cwd, outputPath);
  await writeFile(target, digest, "utf8");
  return target;
}

async function processDirectory(directoryPath, name, relativePath, depth, shouldExclude, shouldInclude, state, includePdf) {
  if (depth > MAX_DIRECTORY_DEPTH) {
    return null;
  }

  const entries = await readdir(directoryPath, { withFileTypes: true });
  const children = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (shouldExclude(childRelativePath, entry.isDirectory())) {
      if (entry.isDirectory()) {
        state.excludedDirectories.add(childRelativePath);
      }
      if (state.verbose) {
        process.stderr.write(`Excluded: ${childRelativePath}\n`);
      }
      continue;
    }

    if (entry.isSymbolicLink()) {
      if (shouldInclude && !shouldInclude(childRelativePath, false)) {
        continue;
      }
      children.push(await processSymlink(absolutePath, entry.name, childRelativePath));
      state.filesAnalyzed += 1;
      continue;
    }

    if (entry.isDirectory()) {
      const child = await processDirectory(
        absolutePath,
        entry.name,
        childRelativePath,
        depth + 1,
        shouldExclude,
        shouldInclude,
        state,
        includePdf,
      );

      if (child && child.children.length > 0) {
        children.push(child);
      }
      continue;
    }

    if (entry.isFile()) {
      if (shouldInclude && !shouldInclude(childRelativePath, false)) {
        continue;
      }
      const child = await processFile(absolutePath, entry.name, childRelativePath, state, includePdf);
      if (child) {
        children.push(child);
      }
    }
  }

  sortChildren(children);

  return {
    name,
    type: "directory",
    path: directoryPath,
    relativePath,
    children,
  };
}

async function processRootFile(filePath, name, relativePath, shouldExclude, shouldInclude, state, includePdf) {
  if (shouldExclude(relativePath, false)) {
    return null;
  }

  if (shouldInclude && !shouldInclude(relativePath, false)) {
    return null;
  }

  return await processFile(filePath, name, relativePath, state, includePdf);
}

async function processFile(filePath, name, relativePath, state, includePdf) {
  if (state.filesAnalyzed + 1 > MAX_FILES) {
    if (state.verbose) {
      process.stderr.write(`Skipped (max files): ${relativePath}\n`);
    }
    return null;
  }

  const fileStats = await stat(filePath);
  if (fileStats.size > state.maxFileSize || state.totalSize + fileStats.size > MAX_TOTAL_SIZE_BYTES) {
    if (state.verbose) {
      process.stderr.write(`Skipped (size limit): ${relativePath} (${fileStats.size.toLocaleString("en-US")} bytes)\n`);
    }
    return null;
  }

  if (state.verbose) {
    process.stderr.write(`Processing: ${relativePath} (${fileStats.size.toLocaleString("en-US")} bytes)\n`);
  }

  state.filesAnalyzed += 1;
  state.totalSize += fileStats.size;
  const content = state.dryRun ? "" : await readFileContent(filePath, name, includePdf, state.verbose, state.convertIpynb);

  if (!state.dryRun) {
    const stats = countTextStats(content);
    state.totalWords += stats.words;
    state.totalLines += stats.lines;
  }

  return {
    name,
    type: "file",
    path: filePath,
    relativePath,
    size: fileStats.size,
    content,
  };
}

async function processSymlink(filePath, name, relativePath) {
  let target = "";
  try {
    target = await realpath(filePath);
  } catch {
    target = "unresolved";
  }

  return {
    name,
    type: "symlink",
    path: filePath,
    relativePath,
    target: path.basename(target),
    content: "",
  };
}

async function readFileContent(filePath, name, includePdf, verbose, convertIpynb) {
  if (includePdf && path.extname(name).toLowerCase() === ".pdf") {
    return await extractPdfText(filePath, verbose);
  }

  if (convertIpynb && path.extname(name).toLowerCase() === ".ipynb") {
    return await extractIpynbContent(filePath, verbose);
  }

  const data = await readFile(filePath);
  if (data.length === 0) {
    return "[Empty file]";
  }

  const sample = data.subarray(0, SAMPLE_SIZE);
  if (sample.includes(0)) {
    return "[Binary file]";
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch (error) {
    return `[Binary or unreadable file: ${error.message}]`;
  }
}

async function extractPdfText(filePath, verbose) {
  const restoreStderr = suppressStderr(!verbose);
  try {
    const parser = await getLiteParseParser();
    const result = await parser.parse(filePath);
    const totalPages = result.pages?.length ?? 0;
    const text = result.text?.trim() ?? "";
    const header = `[PDF document - ${totalPages} page${totalPages === 1 ? "" : "s"} parsed by LiteParse]`;
    return text.trim() ? `${header}\n\n${text}` : `${header}\n\n[No extractable text]`;
  } catch (error) {
    return `[PDF text extraction failed: ${error.message}]`;
  } finally {
    restoreStderr();
  }
}

async function getLiteParseParser() {
  if (!liteParseParserPromise) {
    liteParseParserPromise = import("@llamaindex/liteparse").then(({ LiteParse }) =>
      new LiteParse({
        ocrEnabled: false,
        outputFormat: "text",
        quiet: true,
      }),
    );
  }

  return liteParseParserPromise;
}

async function extractIpynbContent(filePath, verbose) {
  const restoreStderr = suppressStderr(!verbose);
  try {
    const data = await readFile(filePath, "utf8");
    const notebook = JSON.parse(data);
    const parts = [];

    parts.push(`[Jupyter Notebook]`);

    const kernel = notebook.metadata?.kernelspec?.display_name;
    const lang = notebook.metadata?.language_info?.name;
    const langVersion = notebook.metadata?.language_info?.version;
    if (kernel) {
      parts.push(`Kernel: ${kernel}`);
    }
    if (lang) {
      parts.push(`Language: ${lang}${langVersion ? ` ${langVersion}` : ""}`);
    }
    parts.push(`nbformat: ${notebook.nbformat}.${notebook.nbformat_minor}`);

    const cells = notebook.cells || [];
    if (cells.length > 0) {
      parts.push(`Cells: ${cells.length}`);
    }
    parts.push("");

    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const cellType = cell.cell_type;
      const cellNumber = `[cell ${index + 1}]`;
      const executed = cell.execution_count != null && cell.execution_count !== undefined;

      let header = "";
      if (cellType === "markdown") {
        header = `${cellNumber} markdown`;
      } else if (cellType === "raw") {
        header = `${cellNumber} raw`;
      } else {
        const execInfo = executed ? ` (execution ${cell.execution_count})` : "";
        header = `${cellNumber} code${execInfo}`;
      }
      parts.push(header);

      const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source;
      parts.push(source);

      if (cell.outputs && cell.outputs.length > 0) {
        parts.push("");
        for (let oi = 0; oi < cell.outputs.length; oi += 1) {
          const output = cell.outputs[oi];
          parts.push(`${cellNumber} output [${output.output_type}]`);

          if (output.text) {
            const text = Array.isArray(output.text) ? output.text.join("") : output.text;
            parts.push(text);
          }

          if (output.data) {
            if (output.data["text/plain"]) {
              const plain = Array.isArray(output.data["text/plain"])
                ? output.data["text/plain"].join("")
                : output.data["text/plain"];
              parts.push(plain);
            } else {
              parts.push(`[output types: ${Object.keys(output.data).join(", ")}]`);
            }
          }
        }
      }

      parts.push("");
    }

    return parts.join("\n");
  } catch (error) {
    return `[Notebook parsing failed: ${error.message}]`;
  } finally {
    restoreStderr();
  }
}

function suppressStderr(suppress) {
  if (!suppress) {
    return () => {};
  }
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  return () => {
    process.stderr.write = original;
  };
}

function filterEnvPatterns(patterns) {
  return patterns.filter((pattern) => {
    const normalized = String(pattern).replace(/^!/, "").replaceAll("\\", "/").replace(/^\.\/+/, "");
    return !normalized.startsWith(".env");
  });
}

function filterPdfPattern(patterns, includePdf) {
  if (!includePdf) {
    return patterns;
  }
  return patterns.filter((pattern) => pattern !== "*.pdf");
}

function normalizePdfExcludePattern(pattern) {
  return String(pattern).toLowerCase() === "pdf" ? PDF_EXCLUDE_PATTERNS[0] : pattern;
}

async function loadIgnorePatterns(rootPath, ignoreFileNames) {
  const patterns = [];
  const names = new Set(ignoreFileNames);

  await walkIgnoreFiles(rootPath, rootPath, names, patterns);
  return patterns;
}

async function walkIgnoreFiles(rootPath, currentPath, ignoreFileNames, patterns) {
  let entries = [];
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== ".git" && entry.name !== "node_modules") {
      await walkIgnoreFiles(rootPath, absolutePath, ignoreFileNames, patterns);
      continue;
    }

    if (entry.isFile() && ignoreFileNames.has(entry.name)) {
      const baseDirectory = path.relative(rootPath, currentPath).replaceAll(path.sep, "/");
      const text = await readFile(absolutePath, "utf8");
      patterns.push(...parseIgnoreFile(text, baseDirectory));
    }
  }
}

function collectTemplatePatterns(templateNames) {
  const patterns = [];

  for (const name of templateNames) {
    const template = TEMPLATE_PATTERNS[name];
    if (!template) {
      const available = Object.keys(TEMPLATE_PATTERNS).join(", ");
      throw new Error(`Unknown template "${name}". Available templates: ${available}`);
    }

    patterns.push(...template);
  }

  return patterns;
}

function createSummary({ rootName, resolvedRoot, filesAnalyzed, totalWords, totalLines, includeStats, excludedDirectories }) {
  const excludedList = formatExcludedDirectories(excludedDirectories);
  const lines = [
    `Directory: ${rootName}`,
    `Path: ${resolvedRoot}`,
    `Files analyzed: ${filesAnalyzed.toLocaleString("en-US")}`,
    `Excluded directories: ${excludedList}`,
  ];

  if (includeStats) {
    lines.splice(3, 0, `Stats: ${totalWords.toLocaleString("en-US")} words, ${totalLines.toLocaleString("en-US")} lines`);
  }

  return lines.join("\n");
}

function countTextStats(content) {
  return {
    words: countWords(content),
    lines: countLines(content),
  };
}

function countWords(content) {
  return content.trim().match(/\S+/g)?.length ?? 0;
}

function countLines(content) {
  if (!content) {
    return 0;
  }

  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n").length : normalized.split("\n").length;
}

function createTree(node, prefix = "", isLast = true) {
  const marker = isLast ? "└── " : "├── ";
  const displayName = formatTreeName(node);
  let tree = `${prefix}${marker}${displayName}\n`;

  if (node.type === "directory") {
    const childPrefix = `${prefix}${isLast ? "    " : "│   "}`;
    node.children.forEach((child, index) => {
      tree += createTree(child, childPrefix, index === node.children.length - 1);
    });
  }

  return tree;
}

function formatTreeName(node) {
  if (node.type === "directory") {
    return `${node.name}/`;
  }

  if (node.type === "symlink") {
    return `${node.name} -> ${node.target}`;
  }

  return node.name;
}

function gatherFileContents(node, lineNumbers = false) {
  if (node.type === "directory") {
    return node.children.map((child) => gatherFileContents(child, lineNumbers)).join("\n");
  }

  const label = node.type === "symlink" ? "SYMLINK" : "FILE";
  const target = node.type === "symlink" ? ` -> ${node.target}` : "";
  const body = lineNumbers && node.type === "file" ? addLineNumbers(node.content) : node.content;
  return `${SEPARATOR}\n${label}: ${node.relativePath}${target}\n${SEPARATOR}\n${body}\n\n`;
}

function addLineNumbers(content) {
  if (!content) {
    return content;
  }

  const hadTrailingNewline = content.endsWith("\n");
  const body = hadTrailingNewline ? content.slice(0, -1) : content;
  const lines = body.split("\n");
  const width = String(lines.length).length;
  const numbered = lines.map((line, index) => `${String(index + 1).padStart(width, " ")} | ${line}`).join("\n");
  return hadTrailingNewline ? `${numbered}\n` : numbered;
}

function sortChildren(children) {
  children.sort((left, right) => {
    const leftKey = sortKey(left);
    const rightKey = sortKey(right);

    if (leftKey[0] !== rightKey[0]) {
      return leftKey[0] - rightKey[0];
    }

    return leftKey[1].localeCompare(rightKey[1]);
  });
}

function sortKey(node) {
  const name = node.name.toLowerCase();
  if (node.type === "file") {
    if (name === "readme" || name.startsWith("readme.")) {
      return [0, name];
    }

    return [name.startsWith(".") ? 2 : 1, name];
  }

  return [name.startsWith(".") ? 4 : 3, name];
}

function formatExcludedDirectories(excludedDirectories) {
  const directories = [...excludedDirectories].sort();

  if (directories.length === 0) {
    return "None";
  }

  if (directories.length <= 20) {
    return directories.join(", ");
  }

  return `${directories.slice(0, 20).join(", ")} and ${directories.length - 20} more`;
}
