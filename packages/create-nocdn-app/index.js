#!/usr/bin/env node

import * as clack from "@clack/prompts";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const VERSION = "0.0.2";

const args = process.argv.slice(2);
const flags = {
  help: args.includes("-h") || args.includes("--help"),
  version: args.includes("-v") || args.includes("--version"),
  skipInstall: args.includes("--skip-install"),
  skipGit: args.includes("--skip-git"),
  open: args.includes("--open"),
  useNpm: args.includes("--use-npm"),
  usePnpm: args.includes("--use-pnpm"),
  testing: args.includes("--testing"),
};

const cliProjectName = args.find((arg) => !arg.startsWith("-"));

function showHelp() {
  console.log(`
create-nocdn-app - Scaffold a new Next.js project with:
  Tailwind + TypeScript + Prettier + Shiki + Lucide

Usage:
  bunx create-nocdn-app [project-name] [options]

Options:
  -h, --help        Show this help message
  -v, --version     Show version number
  --skip-install    Skip installing dependencies
  --skip-git        Skip initializing git repository
  --open            Open project in default editor after creation
  --use-npm         Use npm instead of bun for installing dependencies
  --use-pnpm        Use pnpm instead of bun for installing dependencies
  --testing         Use local template instead of cloning from GitHub (for development)

Examples:
  bunx create-nocdn-app                    Interactive mode
  bunx create-nocdn-app my-app             Create project named "my-app"
  bunx create-nocdn-app my-app --skip-git  Create without git init
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

function getPackageManager() {
  if (flags.useNpm) return { name: "npm", install: "npm install" };
  if (flags.usePnpm) return { name: "pnpm", install: "pnpm install" };
  return { name: "bun", install: "bun install" };
}

async function main() {
  console.clear();

  clack.intro("create-nocdn-app");

  const framework = await clack.select({
    message: "Which framework would you like to use?",
    options: [
      { value: "next", label: "Next.js (TypeScript, Compiler)" },
      { value: "vite", label: "Vite (TypeScript, React, Compiler)" },
    ],
  });

  if (clack.isCancel(framework)) {
    clack.cancel("Operation cancelled");
    process.exit(0);
  }

  if (framework === "vite") {
    clack.log.info("Coming soon!");
    clack.outro("Stay tuned for Vite support");
    process.exit(0);
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

  const projectDescription = await clack.text({
    message: "Project description (optional, press Enter to skip)",
    placeholder: "A brief description of your project",
  });

  if (clack.isCancel(projectDescription)) {
    clack.cancel("Operation cancelled");
    process.exit(0);
  }

  let agentsContent = null;

  const createAgentsMd = await clack.confirm({
    message: "Create an AGENTS.md file?",
    initialValue: true,
  });

  if (clack.isCancel(createAgentsMd)) {
    clack.cancel("Operation cancelled");
    process.exit(0);
  }

  if (createAgentsMd) {
    const agentsOption = await clack.select({
      message: "How would you like to create AGENTS.md?",
      options: [
        { value: "blank-edit", label: "Create blank and edit now" },
        { value: "minimal", label: "Create minimal (specify runtime)" },
        {
          value: "minimal-edit",
          label: "Create minimal (specify runtime) and edit now",
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
    } else if (agentsOption === "minimal" || agentsOption === "minimal-edit") {
      const runtime = await clack.select({
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

      const minimalContent = `For this project you must only use ${runtime} for installing dependencies, running builds, dev servers, linting, formatting, etc. Look in the package.json for the scripts. You must NOT use the other package managers/runtimes unless the user specifies.`;

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

  const s = clack.spinner();
  const pm = getPackageManager();

  try {
    const projectPath = path.join(process.cwd(), projectName);

    try {
      await fs.access(projectPath);
      clack.cancel(`Directory ${projectName} already exists`);
      process.exit(1);
    } catch {}

    s.start(
      flags.testing ? "Copying local template..." : "Cloning template..."
    );
    if (flags.testing) {
      const scriptDir = new URL(".", import.meta.url).pathname;
      const localTemplatePath = path.join(scriptDir, "templates", "next");
      await fs.cp(localTemplatePath, projectPath, { recursive: true });
      s.stop("Local template copied");
    } else {
      const tempPath = path.join(process.cwd(), `.temp-${Date.now()}`);
      await execAsync(
        `git clone --depth 1 https://github.com/nocdn/create-nocdn-app.git "${tempPath}"`
      );
      await fs.rename(path.join(tempPath, "templates", "next"), projectPath);
      await fs.rm(tempPath, { recursive: true, force: true });
      s.stop("Template cloned");
    }

    s.start("Configuring project...");
    const packageJsonPath = path.join(projectPath, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
    packageJson.name = projectName;
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    const layoutPath = path.join(projectPath, "app", "layout.tsx");
    let layoutContent = await fs.readFile(layoutPath, "utf-8");
    layoutContent = layoutContent.replace(/\{\{project-name\}\}/g, projectName);
    if (projectDescription && projectDescription.trim()) {
      layoutContent = layoutContent.replace(
        /description:\s*[\s\S]*?(?=,\n|\n\};)/,
        `description: "${projectDescription.trim()}"`
      );
    }
    await fs.writeFile(layoutPath, layoutContent);

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

    const runCmd = pm.name === "bun" ? "bun run dev" : `${pm.name} run dev`;
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
