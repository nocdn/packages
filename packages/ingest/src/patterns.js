const SPLIT_PATTERN = /[,\s]+/;

export const TEMPLATE_PATTERNS = {
  nextjs: [
    ".next/",
    "out/",
    ".vercel/",
    ".turbo/",
    "next-env.d.ts",
    "coverage/",
    "playwright-report/",
    "test-results/",
    ".env*.local",
    "tsconfig.tsbuildinfo",
  ],
  node: [
    "coverage/",
    "dist/",
    "build/",
    "out/",
    ".nyc_output/",
    ".tap/",
    "*.tsbuildinfo",
    "*.log",
    "logs/",
    ".env*.local",
  ],
  bun: [
    "coverage/",
    "dist/",
    "build/",
    "out/",
    ".bun/",
    "*.tsbuildinfo",
    "*.log",
    "logs/",
    ".env*.local",
  ],
  hono: [
    "coverage/",
    "dist/",
    "build/",
    "out/",
    ".wrangler/",
    ".dev.vars",
    ".dev.vars.*",
    "*.tsbuildinfo",
    "*.log",
    "logs/",
    ".env*.local",
  ],
  vite: [
    "dist/",
    "coverage/",
    ".vite/",
    ".vitest/",
    "playwright-report/",
    "test-results/",
    "storybook-static/",
    "*.tsbuildinfo",
    ".env*.local",
  ],
  react: [
    "build/",
    "dist/",
    "coverage/",
    ".vite/",
    ".vitest/",
    "playwright-report/",
    "test-results/",
    "storybook-static/",
    "*.tsbuildinfo",
    ".env*.local",
  ],
  python: [
    "__pycache__/",
    ".pytest_cache/",
    ".mypy_cache/",
    ".ruff_cache/",
    ".nox/",
    ".tox/",
    ".hypothesis/",
    ".venv/",
    "venv/",
    "env/",
    "htmlcov/",
    "build/",
    "dist/",
    "*.egg-info/",
    ".coverage",
    ".coverage.*",
    "*.pyc",
    "*.pyo",
  ],
  rust: [
    "target/",
    "debug/",
    "release/",
    "criterion/",
    "coverage/",
    "tarpaulin-report.html",
    "*.profraw",
    "*.profdata",
  ],
  go: [
    "bin/",
    "pkg/",
    "dist/",
    "coverage/",
    "vendor/",
    "*.test",
    "*.out",
    "coverage.out",
  ],
  docs: [
    "site/",
    "public/",
    ".docusaurus/",
    ".vitepress/cache/",
    ".vitepress/dist/",
    ".vuepress/dist/",
    "docs/.vitepress/cache/",
    "docs/.vitepress/dist/",
    "docs/.vuepress/dist/",
    "node_modules/",
  ],
};

export const BUILT_IN_EXCLUDE_PATTERNS = [
  "*.pyc",
  "*.pyo",
  "*.pyd",
  "__pycache__",
  ".pytest_cache",
  ".coverage",
  ".tox",
  ".nox",
  ".mypy_cache",
  ".ruff_cache",
  ".hypothesis",
  "poetry.lock",
  "Pipfile.lock",
  "node_modules",
  "bower_components",
  "package-lock.json",
  "yarn.lock",
  ".npm",
  ".yarn",
  ".pnpm-store",
  "bun.lock",
  "bun.lockb",
  "*.class",
  "*.jar",
  "*.war",
  "*.ear",
  "*.nar",
  ".gradle/",
  "build/",
  ".settings/",
  ".classpath",
  "gradle-app.setting",
  "*.gradle",
  ".project",
  "*.o",
  "*.obj",
  "*.dll",
  "*.dylib",
  "*.exe",
  "*.lib",
  "*.out",
  "*.a",
  "*.pdb",
  "*.bin",
  ".build/",
  "*.xcodeproj/",
  "*.xcworkspace/",
  "*.pbxuser",
  "*.mode1v3",
  "*.mode2v3",
  "*.perspectivev3",
  "*.xcuserstate",
  "xcuserdata/",
  ".swiftpm/",
  "*.gem",
  ".bundle/",
  "vendor/bundle",
  "Gemfile.lock",
  ".ruby-version",
  ".ruby-gemset",
  ".rvmrc",
  "Cargo.lock",
  "**/*.rs.bk",
  "target/",
  "pkg/",
  "obj/",
  "*.suo",
  "*.user",
  "*.userosscache",
  "*.sln.docstates",
  "*.nupkg",
  ".git",
  ".svn",
  ".hg",
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  "*.svg",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.ico",
  "*.pdf",
  "*.mov",
  "*.mp4",
  "*.mp3",
  "*.wav",
  "venv",
  ".venv",
  "env",
  ".env",
  "virtualenv",
  ".idea",
  ".vscode",
  ".vs",
  "*.swo",
  "*.swn",
  "*.sublime-*",
  "*.log",
  "*.bak",
  "*.swp",
  "*.tmp",
  "*.temp",
  ".cache",
  ".sass-cache",
  ".eslintcache",
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "build",
  "dist",
  "target",
  "out",
  "*.egg-info",
  "*.egg",
  "*.whl",
  "*.so",
  "site-packages",
  ".docusaurus",
  ".next",
  ".nuxt",
  "*.db",
  "*.sqlite",
  "*.sqlite3",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.tfstate*",
  "vendor/",
  "digest.txt",
];

const DANGEROUS_PATH_NAMES = new Set([
  ".cache",
  ".git",
  ".hg",
  ".next",
  ".nuxt",
  ".svn",
  ".venv",
  "bower_components",
  "build",
  "dist",
  "env",
  "node_modules",
  "out",
  "target",
  "vendor",
  "vendor/bundle",
  "venv",
  "virtualenv",
]);

export function parsePatterns(values) {
  return values.flatMap((value) =>
    String(value)
      .split(SPLIT_PATTERN)
      .map((part) => normalizePattern(part.trim()))
      .filter(Boolean),
  );
}

export function normalizePattern(pattern) {
  return pattern.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function isDangerousIgnorePattern(pattern) {
  const normalized = normalizePattern(pattern)
    .replace(/^!/, "")
    .replace(/\/\*\*$/, "")
    .replace(/\/+$/, "");

  return DANGEROUS_PATH_NAMES.has(normalized);
}

export function createPatternMatcher(patterns) {
  const positive = [];
  const negative = [];

  for (const rawPattern of patterns) {
    const pattern = normalizePattern(rawPattern);
    if (!pattern || pattern.startsWith("#")) {
      continue;
    }

    if (pattern.startsWith("!")) {
      negative.push(compilePattern(pattern.slice(1)));
    } else {
      positive.push(compilePattern(pattern));
    }
  }

  return (relativePath, isDirectory = false) => {
    const path = normalizePath(relativePath);
    let matched = positive.some((matcher) => matcher(path, isDirectory));

    if (matched && negative.some((matcher) => matcher(path, isDirectory))) {
      matched = false;
    }

    return matched;
  };
}

export function createIncludeMatcher(patterns) {
  const matchers = parsePatterns(patterns).map((pattern) => compilePattern(pattern));

  if (matchers.length === 0) {
    return null;
  }

  return (relativePath, isDirectory = false) => {
    if (isDirectory) {
      return true;
    }

    const path = normalizePath(relativePath);
    return matchers.some((matcher) => matcher(path, false));
  };
}

export function parseIgnoreFile(text, baseDirectory = "") {
  const base = normalizePath(baseDirectory);
  const patterns = [];

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const negated = line.startsWith("!");
    if (negated) {
      line = line.slice(1);
    }

    line = line.replace(/^\/+/, "");
    const pattern = [base, line].filter(Boolean).join("/");
    patterns.push(negated ? `!${pattern}` : pattern);
  }

  return patterns;
}

function compilePattern(pattern) {
  const normalized = normalizePattern(pattern);
  const directoryOnly = normalized.endsWith("/");
  const body = directoryOnly ? normalized.slice(0, -1) : normalized;
  const basenameOnly = !body.includes("/");
  const regex = globToRegex(body);

  return (relativePath, isDirectory) => {
    const path = normalizePath(relativePath);
    const candidates = basenameOnly ? path.split("/") : [path];

    if (directoryOnly && !isDirectory && !path.includes(`${body}/`)) {
      return false;
    }

    if (candidates.some((candidate) => regex.test(candidate))) {
      return true;
    }

    return !basenameOnly && path.startsWith(`${body}/`);
  };
}

function globToRegex(pattern) {
  let source = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*" && pattern[index + 2] === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char);
    }
  }

  return new RegExp(`^${source}$`);
}

function normalizePath(path) {
  return String(path).replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

function escapeRegex(char) {
  return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
}
