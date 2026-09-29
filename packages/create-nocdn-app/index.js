#!/usr/bin/env node

import * as clack from "@clack/prompts";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const execFileAsync = promisify(execFile);
const templatesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
);

const packageJsonUrl = new URL("./package.json", import.meta.url);
const { version: VERSION } = JSON.parse(
  await fs.readFile(packageJsonUrl, "utf-8"),
);

let parsedArgs;
try {
  parsedArgs = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      "skip-install": { type: "boolean" },
      "skip-git": { type: "boolean" },
      open: { type: "boolean" },
      "use-npm": { type: "boolean" },
      "use-pnpm": { type: "boolean" },
      template: { type: "string", short: "t" },
      port: { type: "string", short: "p" },
      description: { type: "string", short: "d" },
      "no-agents": { type: "boolean" },
      agents: { type: "string", short: "a" },
      runtime: { type: "string" },
    },
  });
} catch (error) {
  console.error(`error: ${error.message}`);
  console.error("Run create-nocdn-app --help for usage.");
  process.exit(1);
}

const { values, positionals } = parsedArgs;

if (positionals.length > 1) {
  console.error(
    `error: expected at most one project name, got: ${positionals.join(" ")}`,
  );
  process.exit(1);
}

const flags = {
  help: values.help === true,
  version: values.version === true,
  skipInstall: values["skip-install"] === true,
  skipGit: values["skip-git"] === true,
  open: values.open === true,
  useNpm: values["use-npm"] === true,
  usePnpm: values["use-pnpm"] === true,
  template: values.template ?? null,
  port: values.port ?? null,
  description: values.description ?? null,
  noAgents: values["no-agents"] === true,
  agents: values.agents ?? null,
  runtime: values.runtime ?? null,
};

const cliProjectName = positionals[0];

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
  if (value.length > 214) return "Project name must be 214 characters or fewer";
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) {
    return "Project name must start and end with a lowercase letter or number and can contain hyphens";
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
  if (flags.useNpm) return { name: "npm" };
  if (flags.usePnpm) return { name: "pnpm" };
  return { name: "bun" };
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
    installPackageManager: { name: "bun" },
    runCommand: () => "bun run dev",
  };
}

async function replaceInFile(filePath, replacements) {
  let content = await fs.readFile(filePath, "utf-8");

  for (const [placeholder, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${placeholder}}}`, () => String(value));
  }

  await fs.writeFile(filePath, content);
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
        "When running tests, smoke checks, imports, dev servers, or one-off scripts, always wrap commands that could hang or run indefinitely in an explicit timeout. Use the best available mechanism for the context, such as the Unix timeout command, Bun/Node timers with abort signals, test runner timeouts, or shell patterns that kill the process after a bounded duration. Do not run open-ended commands like importing the app, starting a server, watching files, or calling long-lived requests without a timeout.",
        "When you add, change, or remove features, update the README.md and any helper routes to reflect the changes (routes, environment variables, behavior, etc.).",
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
      const runtime =
        flags.runtime ??
        (framework === "hono" ? "bun" : null);

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

    if (existsSync(projectPath)) {
      clack.cancel(`Directory ${projectName} already exists`);
      process.exit(1);
    }

    if (framework === "hono" && (flags.useNpm || flags.usePnpm)) {
      clack.log.info(
        "The Hono template uses Bun, so dependencies will be installed with bun.",
      );
    }

    // Templates ship inside this package, so the scaffold always matches the
    // version being run and works offline.
    s.start("Copying template...");
    await fs.cp(path.join(templatesDir, templateDir), projectPath, {
      recursive: true,
      dereference: true,
    });
    await fs.copyFile(
      path.join(templatesDir, "shared", "gitignore"),
      path.join(projectPath, ".gitignore"),
    );
    // npm never packs .gitignore or .npmignore files, so templates store
    // them without the leading dot.
    if (existsSync(path.join(projectPath, "npmignore"))) {
      await fs.rename(
        path.join(projectPath, "npmignore"),
        path.join(projectPath, ".npmignore"),
      );
    }
    s.stop("Template copied");

    s.start("Configuring project...");

    const packageJsonPath = path.join(projectPath, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
    packageJson.name = projectName;
    await fs.writeFile(
      packageJsonPath,
      `${JSON.stringify(packageJson, null, 2)}\n`,
    );

    if (framework === "next") {
      const layoutPath = path.join(projectPath, "app", "layout.tsx");
      const descriptionValue =
        projectDescription && projectDescription.trim()
          ? projectDescription.trim()
          : "generated by create-nocdn-app";
      const replacements = {
        "project-name": projectName,
        "project-description-escaped": JSON.stringify(descriptionValue).slice(
          1,
          -1,
        ),
      };

      await Promise.all([
        replaceInFile(layoutPath, replacements),
        replaceInFile(path.join(projectPath, "README.md"), replacements),
      ]);
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
        "project-description-escaped": JSON.stringify(descriptionValue).slice(
          1,
          -1,
        ),
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
        replaceInFile(path.join(projectPath, "src", "app.ts"), replacements),
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
      await run(pm.name, ["install"], { cwd: projectPath });
      s.stop("Dependencies installed");
    }

    if (!flags.skipGit) {
      s.start("Initializing git...");
      await execFileAsync("git", ["init"], { cwd: projectPath });
      await execFileAsync("git", ["add", "."], { cwd: projectPath });
      await execFileAsync("git", ["commit", "-m", "init: initial file upload"], {
        cwd: projectPath,
      });
      s.stop("Git initialized");
    }

    if (flags.open) {
      s.start("Opening in editor...");
      await run("code", ["."], { cwd: projectPath });
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

// Package managers and `code` are .cmd shims on Windows, which only run
// through a shell. Callers pass fixed arguments without spaces, so this is
// safe; use execFileAsync directly for anything else.
function run(command, commandArgs, options = {}) {
  return execFileAsync(command, commandArgs, {
    ...options,
    shell: process.platform === "win32",
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
