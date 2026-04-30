#!/usr/bin/env node

import * as clack from "@clack/prompts";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const execAsync = promisify(exec);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const packageJsonUrl = new URL("./package.json", import.meta.url);
const { version: VERSION } = JSON.parse(
  await fs.readFile(packageJsonUrl, "utf-8"),
);

const args = process.argv.slice(2);

function getArgValue(short, long) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === short || args[i] === long) return args[i + 1] ?? null;
    if (long && args[i].startsWith(`${long}=`)) return args[i].split("=")[1];
  }
  return null;
}

const valuedFlags = new Set();
for (let i = 0; i < args.length; i++) {
  if (
    [
      "-t",
      "--template",
      "-p",
      "--port",
      "-d",
      "--description",
      "-a",
      "--agents",
      "--runtime",
    ].includes(args[i])
  ) {
    valuedFlags.add(i);
    valuedFlags.add(i + 1);
  }
}

const flags = {
  help: args.includes("-h") || args.includes("--help"),
  version: args.includes("-v") || args.includes("--version"),
  skipInstall: args.includes("--skip-install"),
  skipGit: args.includes("--skip-git"),
  open: args.includes("--open"),
  useNpm: args.includes("--use-npm"),
  usePnpm: args.includes("--use-pnpm"),
  testing: args.includes("--testing"),
  template: getArgValue("-t", "--template"),
  port: getArgValue("-p", "--port"),
  description: getArgValue("-d", "--description"),
  noAgents: args.includes("--no-agents"),
  agents: getArgValue("-a", "--agents"),
  runtime: getArgValue(null, "--runtime"),
};

const cliProjectName = args.find(
  (arg, i) => !arg.startsWith("-") && !valuedFlags.has(i),
);

const VALID_TEMPLATES = [
  "next",
  "vite",
  "tanstack",
  "tanstack-start",
  "start",
  "hono",
];
const VALID_AGENTS = ["none", "blank", "minimal"];
const VALID_RUNTIMES = ["bun", "npm", "pnpm", "yarn"];

function normalizeTemplate(value) {
  if (value === "start" || value === "tanstack-start") return "tanstack";
  return value;
}

function showHelp() {
  console.log(`
create-nocdn-app v${VERSION}

Scaffold a new Next.js, Vite, TanStack Start, or Hono project.

Usage:
  bunx create-nocdn-app [project-name] [options]

Template:
  -t, --template <name>    next | vite | tanstack (or start) | hono

Project options:
  -p, --port <number>      Port for Hono API (default: 3000)
  -d, --description <text> Project description (Next.js, TanStack)

AGENTS.md:
  -a, --agents <mode>      none | blank | minimal (default: prompt)
  --no-agents              Shorthand for --agents none
  --runtime <name>         bun | npm | pnpm | yarn (for minimal agents, default: bun)

General:
  --skip-install           Skip installing dependencies
  --skip-git               Skip initializing git repository
  --open                   Open project in default editor after creation
  --use-npm                Use npm instead of bun for installing dependencies
  --use-pnpm               Use pnpm instead of bun for installing dependencies
  -h, --help               Show this help message
  -v, --version            Show version number

Examples:
  bunx create-nocdn-app
  bunx create-nocdn-app my-app -t hono -p 8080 --agents minimal
  bunx create-nocdn-app my-app -t next -d "My website" --no-agents
  bunx create-nocdn-app my-app -t tanstack --skip-git --skip-install
  bunx create-nocdn-app my-app -t vite --agents minimal --runtime pnpm
`);
  process.exit(0);
}

function showVersion() {
  console.log(`create-nocdn-app v${VERSION}`);
  process.exit(0);
}

if (flags.help) showHelp();
if (flags.version) showVersion();

function validateProjectName(value) {
  if (value.length === 0) return "Project name is required";
  if (!/^[a-z0-9-]+$/.test(value)) {
    return "Project name must be lowercase, alphanumeric, and can contain hyphens";
  }
}

function validatePort(value) {
  if (value.length === 0) return "Port is required";
  if (!/^\d+$/.test(value)) return "Port must be a number";

  const port = Number(value);

  if (port < 1 || port > 65535) {
    return "Port must be between 1 and 65535";
  }
}

function getPackageManager() {
  if (flags.useNpm) return { name: "npm", install: "npm install" };
  if (flags.usePnpm) return { name: "pnpm", install: "pnpm install" };
  return { name: "bun", install: "bun install" };
}

function getFrameworkConfig(framework) {
  if (framework === "next") {
    return {
      templateDir: "next",
      runCommand: (pm) =>
        pm.name === "bun" ? "bun run dev" : `${pm.name} run dev`,
    };
  }

  if (framework === "vite") {
    return {
      templateDir: "vite",
      runCommand: (pm) =>
        pm.name === "bun" ? "bun run dev" : `${pm.name} run dev`,
    };
  }

  if (framework === "tanstack") {
    return {
      templateDir: "tanstack",
      runCommand: (pm) =>
        pm.name === "bun" ? "bun run dev" : `${pm.name} run dev`,
    };
  }

  return {
    templateDir: "hono",
    installPackageManager: { name: "bun", install: "bun install" },
    runCommand: () => "bun run dev",
  };
}

async function replaceInFile(filePath, replacements) {
  let content = await fs.readFile(filePath, "utf-8");

  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${placeholder}}}`, value);
  }

  await fs.writeFile(filePath, content);
}

async function renameIfExists(sourcePath, targetPath) {
  try {
    await fs.access(sourcePath);
    await fs.rename(sourcePath, targetPath);
  } catch {}
}

function buildMinimalAgentsContent(framework, runtime) {
  let content = `For this project you must only use ${runtime} for installing dependencies, running builds, dev servers, linting, formatting, etc. Look in the package.json for the scripts. You must NOT use the other package managers/runtimes unless the user specifies.`;

  if (framework === "next") {
    content +=
      "\n\n" +
      [
        "Prefer the project's custom Link component in components/link.tsx over next/link, because it navigates onMouseDown. Wherever navigation links are used in the app, do not disable prefetching unless the user explicitly asks for that behavior.",
      ].join("\n\n");
  }

  if (framework === "hono") {
    content +=
      "\n\n" +
      [
        "Keep the Docker container lean. Avoid unnecessary dependencies and bloat, but do not add extra complexity or convoluted workarounds just to shave off image size - simplicity (and readability) takes priority over minimalism.",
        "When writing a .env.example file, include a short, clear, professional comment above each variable explaining its purpose. Group related variables together. Make sure to update it when you add, change or remove features from the project.",
        "All API routes must be prefixed with /api/ (e.g. /api/users, /api/health).",
        "Use Hono's built-in logger middleware (https://hono.dev/docs/middleware/builtin/logger) for request logging. Import it from 'hono/logger'.",
        "For rate limiting, use hono-rate-limiter (https://honohub.dev/docs/rate-limiter). Rate limits are global for the entire app (not per-IP or per-user). All rate limit values (windowMs and limit) must be configurable via environment variables. The /api/health endpoint has its own separate rate limit (default: 1 request per 500ms) independent from the main rate limit (default: 100 requests per 15 minutes). Never combine health and main rate limits into a single limiter.",
        "When you add, change, or remove features, update the README.md to reflect the changes (routes, environment variables, behavior, etc.).",
        "The root route (GET /) must return a plain-text usage page (Content-Type: text/plain) that acts as a fast, efficient quick-reference for using the API. It is not the README - keep it tight, cover the most important usage info, and skip prose. Use indentation wherever it improves readability: JSON responses MUST be pretty-printed with proper indentation (2 spaces), and curl examples MUST use backslash line continuations with small indents for headers and body so they are easy to read. Do NOT use any markdown formatting (no headings, no bold, no italics, no lists, no code fences, no backticks) EXCEPT for the markdown tables described below. All markdown tables MUST be padded so every column is the same width across all rows - vertically align the pipe characters by adding spaces inside cells until every cell in a given column has equal width (including the header separator row). The header separator row's dash count for each column must match the padded width of that column exactly. This matters: the page is read as plain text in a terminal, not just rendered, so get the alignment right - cramped tables where every cell is sized to its own content are not acceptable. Use standard markdown table structure (header row, separator row, data rows) - do NOT add a top border row or a bottom border row, just the standard three parts. Concrete example of the expected style:\n\n| Method | Path            | Description                         |\n| ------ | --------------- | ----------------------------------- |\n| GET    | /api/health     | service status and configuration    |\n| POST   | /api/check      | run a fact-check (direct or queued) |\n| GET    | /api/check/:id  | poll a queued job                   |\n\nNote how every cell in a given column is padded to the same width and all the pipes line up vertically - tables anywhere on the page must look like that. Every markdown table in this page must be preceded by a one-line heading that ends with a colon (e.g. \"Routes:\" before the routes table, \"Request Fields:\" before a per-route fields table), with a single blank line between the heading and the table. These colon-headings are plain text, not markdown headings - just words ending with a colon on their own line. Put exactly three blank lines between each top-level section. Structure: (1) The project name on the first line, then on the next line a row of '=' characters whose length exactly matches the length of the project name (Setext-style underline - this is the one exception to the no-markdown rule because it doubles as nice plain-text styling), then a blank line, then a single concise, technical, all-lowercase sentence describing what this project does - no filler, no marketing language, just the technical fact of what it is (e.g. \"wraps yt-dlp and streams the resulting media file over http\"). (2) A markdown table of every route with columns Method | Path | Description, where Description is a few words at most. Order the rows by importance, with the primary/most-used endpoint (the one users actually came here to use) first, then the next most useful, and so on - utility endpoints like /api/health belong at the end. (3) For every route, in the SAME importance order as the table (not alphabetical, not the order they were implemented), a section consisting of three parts in this order: first, a curl example for that route. The curl command itself MUST start at column 0 (no leading indentation on the line that begins with \"curl\", and no leading indentation on any of its continuation lines either - continuation lines should start with two spaces of indent ONLY for readability of -H, -d, --output, etc., relative to the curl line, not as a wrapping indent of the whole block). Do NOT wrap the entire curl block in extra indentation. If the request takes a body, headers, query params, or anything that benefits from formatting, write it pretty with backslash line continuations and small inner indents (e.g. JSON body indented 2 spaces inside the -d argument) and include as many request fields as possible (including optional ones); but if it is a simple request with no body and no headers (e.g. a plain GET /api/health), write the curl on a single line with no backslashes - reserve the multi-line pretty format for curls that actually need it; second, IF and only if the route accepts request fields (body, query params, etc.), a markdown table describing those fields with columns Field | Type | Default, where Type uses TypeScript-style notation (string, string[], boolean, number, etc.) and Default is the literal value in JSON form: quoted strings (\"both\", \"1080p\"), unquoted null, unquoted booleans (true/false), unquoted numbers (8080, 3.14), and a single dash if the field is required with no default. Do NOT use the '|' character anywhere inside table cells - escaping it as \\| leaves a visible backslash in the plain-text output, which is wrong. For union-type values that would normally be written with '|' in TypeScript, use the word \"or\" instead (e.g. write `\"audio\" or \"video\" or \"both\"`, `string or null`). The '|' character is reserved exclusively for the table's column separators. If the route has no request fields at all, OMIT this table entirely (do not insert a placeholder table with rows like \"none, never, -\"); third, an \"Example Response:\" colon-heading on its own line followed by a blank line and then a pretty-printed example JSON response for that request - BUT if the route's success response is not JSON (binary file, audio/video stream, plain text, octet-stream, etc.), do NOT invent fake JSON metadata; instead, write a single concise plain-text sentence under \"Example Response:\" describing what the success response actually is (e.g. \"Streams the downloaded media file with Content-Type matching the source format and Content-Disposition: attachment.\"), and optionally follow it (after a blank line) with an \"Error Response:\" colon-heading and a pretty-printed example error JSON to document the error shape, since errors will typically still be JSON even when success is binary. Within any per-route section, you MAY also include short informational paragraphs of plain prose where useful (e.g. explaining non-obvious behavior, retry/fallback logic, platform-specific edge cases, what a particular field does in detail, when to prefer one mode over another, etc). These paragraphs must be concise, technical, and filler-free - no marketing language, no restatement of the fields table, no obvious statements. Place them where they are most relevant: directly after the curl example, after a specific table, or before the example response - wherever the context fits. Use them sparingly: only when the information is actually useful to a developer using the API and is not already obvious from the curl, the fields table, or the response. Three blank lines also separate each per-route section from the next. When you add, change, or remove API routes, update this root route to keep it accurate - every route must appear in the table and have its own curl + fields table + example response section. If GET / and the actual routes disagree, treat it as a bug and fix GET / in the same change. The page must end with exactly one trailing newline character - no extra blank lines at the very end of the response body.",
      ].join("\n\n");
  }

  return content;
}

function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function main() {
  // Validate flag values early
  if (flags.template && !VALID_TEMPLATES.includes(flags.template)) {
    die(
      `invalid template "${flags.template}". Must be one of: ${VALID_TEMPLATES.join(", ")}`,
    );
  }
  if (flags.agents && !VALID_AGENTS.includes(flags.agents)) {
    die(
      `invalid agents mode "${flags.agents}". Must be one of: ${VALID_AGENTS.join(", ")}`,
    );
  }
  if (flags.runtime && !VALID_RUNTIMES.includes(flags.runtime)) {
    die(
      `invalid runtime "${flags.runtime}". Must be one of: ${VALID_RUNTIMES.join(", ")}`,
    );
  }
  if (flags.port) {
    const portError = validatePort(flags.port);
    if (portError) die(portError);
  }

  const nonInteractive = !!(flags.template && cliProjectName);

  if (!nonInteractive) console.clear();

  clack.intro(`create-nocdn-app (${VERSION})`);

  let framework;

  if (flags.template) {
    framework = normalizeTemplate(flags.template);
    clack.log.info(`Using template: ${framework}`);
  } else {
    framework = await clack.select({
      message: "Which framework would you like to use?",
      options: [
        { value: "next", label: "Next.js (TypeScript, Compiler)" },
        { value: "vite", label: "Vite (TypeScript, React, Compiler)" },
        {
          value: "tanstack",
          label: "TanStack Start (TypeScript, React, Compiler)",
        },
        { value: "hono", label: "Hono (Bun API)" },
      ],
    });

    if (clack.isCancel(framework)) {
      clack.cancel("Operation cancelled");
      process.exit(0);
    }
  }

  let projectName;

  if (cliProjectName) {
    const validationError = validateProjectName(cliProjectName);
    if (validationError) {
      clack.log.error(validationError);
      clack.cancel("Invalid project name");
      process.exit(1);
    }
    projectName = cliProjectName;
    clack.log.info(`Creating project: ${projectName}`);
  } else {
    projectName = await clack.text({
      message: "What is your project name?",
      placeholder: "my-app",
      validate: validateProjectName,
    });

    if (clack.isCancel(projectName)) {
      clack.cancel("Operation cancelled");
      process.exit(0);
    }
  }

  let projectDescription = null;
  let projectPort = null;
  let agentsContent = null;

  if (framework === "next" || framework === "tanstack") {
    if (flags.description !== null) {
      projectDescription = flags.description;
    } else if (!nonInteractive) {
      projectDescription = await clack.text({
        message: "Project description (optional, press Enter to skip)",
        placeholder: "A brief description of your project",
      });

      if (clack.isCancel(projectDescription)) {
        clack.cancel("Operation cancelled");
        process.exit(0);
      }
    }
  } else if (framework === "hono") {
    if (flags.port) {
      projectPort = flags.port;
    } else if (nonInteractive) {
      projectPort = "3000";
    } else {
      projectPort = await clack.text({
        message: "Which port should the API run on?",
        placeholder: "3000",
        initialValue: "3000",
        validate: validatePort,
      });

      if (clack.isCancel(projectPort)) {
        clack.cancel("Operation cancelled");
        process.exit(0);
      }
    }
  }

  if (flags.noAgents) {
    agentsContent = null;
  } else if (flags.agents) {
    if (flags.agents === "none") {
      agentsContent = null;
    } else if (flags.agents === "blank") {
      agentsContent = "";
    } else if (flags.agents === "minimal") {
      const runtime = flags.runtime ?? (framework === "hono" ? "bun" : null);

      if (!runtime) {
        const selectedRuntime = await clack.select({
          message: "Which runtime are you using?",
          options: [
            { value: "bun", label: "Bun" },
            { value: "npm", label: "npm" },
            { value: "pnpm", label: "pnpm" },
            { value: "yarn", label: "Yarn" },
          ],
        });

        if (clack.isCancel(selectedRuntime)) {
          clack.cancel("Operation cancelled");
          process.exit(0);
        }

        agentsContent = buildMinimalAgentsContent(framework, selectedRuntime);
      } else {
        agentsContent = buildMinimalAgentsContent(framework, runtime);
      }
    }
  } else {
    const createAgentsMd = await clack.confirm({
      message: "Create an AGENTS.md file?",
      initialValue: true,
    });

    if (clack.isCancel(createAgentsMd)) {
      clack.cancel("Operation cancelled");
      process.exit(0);
    }

    if (createAgentsMd) {
      const minimalLabel =
        framework === "hono"
          ? "bun runtime, lean containers, .env conventions"
          : "specify runtime";

      const agentsOption = await clack.select({
        message: "How would you like to create AGENTS.md?",
        options: [
          { value: "blank-edit", label: "Create blank and edit now" },
          { value: "minimal", label: `Create minimal (${minimalLabel})` },
          {
            value: "minimal-edit",
            label: `Create minimal (${minimalLabel}) and edit now`,
          },
        ],
      });

      if (clack.isCancel(agentsOption)) {
        clack.cancel("Operation cancelled");
        process.exit(0);
      }

      if (agentsOption === "blank-edit") {
        const content = await clack.text({
          message: "Enter your AGENTS.md content:",
          placeholder: "Instructions for AI agents working on this project...",
        });
        if (clack.isCancel(content)) {
          clack.cancel("Operation cancelled");
          process.exit(0);
        }
        agentsContent = content || "";
      } else if (
        agentsOption === "minimal" ||
        agentsOption === "minimal-edit"
      ) {
        let runtime = "bun";

        if (framework !== "hono") {
          runtime = await clack.select({
            message: "Which runtime are you using?",
            options: [
              { value: "bun", label: "Bun" },
              { value: "npm", label: "npm" },
              { value: "pnpm", label: "pnpm" },
              { value: "yarn", label: "Yarn" },
            ],
          });

          if (clack.isCancel(runtime)) {
            clack.cancel("Operation cancelled");
            process.exit(0);
          }
        }

        const minimalContent = buildMinimalAgentsContent(framework, runtime);

        if (agentsOption === "minimal-edit") {
          const editedContent = await clack.text({
            message: "Edit your AGENTS.md content:",
            initialValue: minimalContent,
          });
          if (clack.isCancel(editedContent)) {
            clack.cancel("Operation cancelled");
            process.exit(0);
          }
          agentsContent = editedContent || minimalContent;
        } else {
          agentsContent = minimalContent;
        }
      }
    }
  }

  const s = clack.spinner();
  const frameworkConfig = getFrameworkConfig(framework);
  const pm = frameworkConfig.installPackageManager ?? getPackageManager();
  const templateDir = frameworkConfig.templateDir;

  try {
    const projectPath = path.join(process.cwd(), projectName);

    try {
      await fs.access(projectPath);
      clack.cancel(`Directory ${projectName} already exists`);
      process.exit(1);
    } catch {}

    if (framework === "hono" && (flags.useNpm || flags.usePnpm)) {
      clack.log.info(
        "The Hono template uses Bun, so dependencies will be installed with bun.",
      );
    }

    s.start(
      flags.testing ? "Copying local template..." : "Cloning template...",
    );
    if (flags.testing) {
      const localTemplatePath = path.join(scriptDir, "templates", templateDir);
      const localSharedPath = path.join(scriptDir, "templates", "shared");
      await fs.cp(localTemplatePath, projectPath, {
        recursive: true,
        dereference: true,
      });
      await fs.copyFile(
        path.join(localSharedPath, "gitignore"),
        path.join(projectPath, ".gitignore"),
      );
      s.stop("Local template copied");
    } else {
      const tempPath = path.join(process.cwd(), `.temp-${Date.now()}`);
      await execAsync(
        `git clone --depth 1 https://github.com/nocdn/create-nocdn-app.git "${tempPath}"`,
      );
      await fs.cp(path.join(tempPath, "templates", templateDir), projectPath, {
        recursive: true,
        dereference: true,
      });
      await fs.copyFile(
        path.join(tempPath, "templates", "shared", "gitignore"),
        path.join(projectPath, ".gitignore"),
      );
      await fs.rm(tempPath, { recursive: true, force: true });
      s.stop("Template cloned");
    }

    s.start("Configuring project...");

    const packageJsonPath = path.join(projectPath, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
    packageJson.name = projectName;
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    if (framework === "next") {
      const layoutPath = path.join(projectPath, "app", "layout.tsx");
      let layoutContent = await fs.readFile(layoutPath, "utf-8");
      layoutContent = layoutContent.replace(
        /\{\{project-name\}\}/g,
        projectName,
      );
      if (projectDescription && projectDescription.trim()) {
        layoutContent = layoutContent.replace(
          /description:\s*[\s\S]*?(?=,\n|\n\};)/,
          `description: "${projectDescription.trim()}"`,
        );
      }
      await fs.writeFile(layoutPath, layoutContent);
    } else if (framework === "vite") {
      const indexHtmlPath = path.join(projectPath, "index.html");
      let indexHtmlContent = await fs.readFile(indexHtmlPath, "utf-8");
      indexHtmlContent = indexHtmlContent.replace(
        /\{\{project-name\}\}/g,
        projectName,
      );
      await fs.writeFile(indexHtmlPath, indexHtmlContent);
    } else if (framework === "tanstack") {
      const descriptionValue =
        projectDescription && projectDescription.trim()
          ? projectDescription.trim()
          : "generated by create-nocdn-app";

      const replacements = {
        "project-name": projectName,
        "project-description": descriptionValue,
      };

      await Promise.all([
        replaceInFile(path.join(projectPath, "README.md"), replacements),
        replaceInFile(
          path.join(projectPath, "src", "routes", "index.tsx"),
          replacements,
        ),
        replaceInFile(
          path.join(projectPath, "src", "routes", "__root.tsx"),
          replacements,
        ),
      ]);
    } else if (framework === "hono") {
      const replacements = {
        "project-name": projectName,
        port: projectPort,
      };

      await Promise.all([
        replaceInFile(path.join(projectPath, "README.md"), replacements),
        replaceInFile(path.join(projectPath, ".env.example"), replacements),
        replaceInFile(path.join(projectPath, "src", "index.ts"), replacements),
        replaceInFile(path.join(projectPath, "compose.yaml"), replacements),
        replaceInFile(path.join(projectPath, "Dockerfile"), replacements),
      ]);
    }

    if (agentsContent !== null) {
      const agentsMdPath = path.join(projectPath, "AGENTS.md");
      await fs.writeFile(agentsMdPath, agentsContent);
    }
    s.stop("Project configured");

    if (!flags.skipInstall) {
      s.start(`Installing dependencies with ${pm.name}...`);
      await execAsync(pm.install, { cwd: projectPath });
      s.stop("Dependencies installed");
    }

    if (!flags.skipGit) {
      s.start("Initializing git...");
      await execAsync("git init", { cwd: projectPath });
      await execAsync("git add .", { cwd: projectPath });
      await execAsync('git commit -m "init: initial file upload"', {
        cwd: projectPath,
      });
      s.stop("Git initialized");
    }

    if (flags.open) {
      s.start("Opening in editor...");
      await execAsync(`code "${projectPath}"`);
      s.stop("Opened in VS Code");
    }

    clack.outro(`Project ${projectName} is ready`);

    const runCmd = frameworkConfig.runCommand(pm);
    console.log(`\nNext steps:
  cd ${projectName}
  ${runCmd}
`);
  } catch (error) {
    s.stop("Error occurred");
    clack.log.error(error.message);
    clack.cancel("Setup failed");
    process.exit(1);
  }
}

main().catch(console.error);
