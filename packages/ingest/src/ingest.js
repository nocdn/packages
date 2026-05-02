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

export async function ingestPath(source = ".", options = {}) {
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
  const templatePatterns = collectTemplatePatterns(options.templates ?? []);
  const userExcludePatterns = parsePatterns(options.exclude ?? []);
  const builtInPatterns = options.includeDangerous ? [] : BUILT_IN_EXCLUDE_PATTERNS;
  const excludePatterns = [
    ...builtInPatterns,
    ...ignoreFilePatterns,
    ...templatePatterns,
    ...userExcludePatterns,
  ];
  const shouldExclude = createPatternMatcher(excludePatterns);
  const shouldInclude = createIncludeMatcher(options.include ?? []);
  const state = {
    rootPath,
    resolvedRoot,
    maxFileSize: options.maxFileSize ?? MAX_FILE_SIZE,
    filesAnalyzed: 0,
    totalSize: 0,
    excludedDirectories: new Set(),
  };

  const rootNode = rootStats.isDirectory()
    ? await processDirectory(rootPath, rootName, "", 0, shouldExclude, shouldInclude, state)
    : await processRootFile(rootPath, rootName, path.basename(rootPath), shouldInclude, state);

  if (!rootNode) {
    throw new Error("No files were available to ingest after exclusions were applied.");
  }

  const tree = `Directory structure:\n${createTree(rootNode)}`;
  const content = gatherFileContents(rootNode).trimEnd();
  const summary = createSummary({
    rootName,
    resolvedRoot,
    filesAnalyzed: state.filesAnalyzed,
    excludedDirectories: state.excludedDirectories,
  });

  return {
    summary,
    tree,
    content,
    digest: `${summary}\n\n${tree}\n\n${content}\n`,
    filesAnalyzed: state.filesAnalyzed,
    excludedDirectories: [...state.excludedDirectories].sort(),
    path: resolvedRoot,
  };
}

export async function writeDigest(outputPath, digest, cwd = process.cwd()) {
  const target = path.resolve(cwd, outputPath);
  await writeFile(target, digest, "utf8");
  return target;
}

async function processDirectory(directoryPath, name, relativePath, depth, shouldExclude, shouldInclude, state) {
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
      const child = await processFile(absolutePath, entry.name, childRelativePath, state);
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

async function processRootFile(filePath, name, relativePath, shouldInclude, state) {
  if (shouldInclude && !shouldInclude(relativePath, false)) {
    return null;
  }

  return await processFile(filePath, name, relativePath, state);
}

async function processFile(filePath, name, relativePath, state) {
  if (state.filesAnalyzed + 1 > MAX_FILES) {
    return null;
  }

  const fileStats = await stat(filePath);
  if (fileStats.size > state.maxFileSize || state.totalSize + fileStats.size > MAX_TOTAL_SIZE_BYTES) {
    return null;
  }

  state.filesAnalyzed += 1;
  state.totalSize += fileStats.size;

  return {
    name,
    type: "file",
    path: filePath,
    relativePath,
    size: fileStats.size,
    content: await readTextFile(filePath),
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

async function readTextFile(filePath) {
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

function createSummary({ rootName, resolvedRoot, filesAnalyzed, excludedDirectories }) {
  const excludedList = formatExcludedDirectories(excludedDirectories);
  const lines = [
    `Directory: ${rootName}`,
    `Path: ${resolvedRoot}`,
    `Files analyzed: ${filesAnalyzed.toLocaleString("en-US")}`,
    `Excluded directories: ${excludedList}`,
  ];

  return lines.join("\n");
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

function gatherFileContents(node) {
  if (node.type === "directory") {
    return node.children.map((child) => gatherFileContents(child)).join("\n");
  }

  const label = node.type === "symlink" ? "SYMLINK" : "FILE";
  const target = node.type === "symlink" ? ` -> ${node.target}` : "";
  return `${SEPARATOR}\n${label}: ${node.relativePath}${target}\n${SEPARATOR}\n${node.content}\n\n`;
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
