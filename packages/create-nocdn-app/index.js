#!/usr/bin/env node

import * as clack from "@clack/prompts";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

async function main() {
	console.clear();

	clack.intro("create-nocdn-app");

	const projectName = await clack.text({
		message: "What is your project name?",
		placeholder: "my-app",
		validate(value) {
			if (value.length === 0) return "Project name is required";
			if (!/^[a-z0-9-]+$/.test(value)) {
				return "Project name must be lowercase, alphanumeric, and can contain hyphens";
			}
		},
	});

	if (clack.isCancel(projectName)) {
		clack.cancel("Operation cancelled");
		process.exit(0);
	}

	const s = clack.spinner();

	try {
		const projectPath = path.join(process.cwd(), projectName);

		try {
			await fs.access(projectPath);
			clack.cancel(`Directory ${projectName} already exists`);
			process.exit(1);
		} catch {}

		s.start("Cloning template...");
		const tempPath = path.join(process.cwd(), `.temp-${Date.now()}`);
		await execAsync(
			`git clone --depth 1 https://github.com/nocdn/create-nocdn-app.git "${tempPath}"`,
		);

		await fs.rename(path.join(tempPath, "template"), projectPath);

		await fs.rm(tempPath, { recursive: true, force: true });
		s.stop("Template cloned");

		s.start("Configuring project...");
		const packageJsonPath = path.join(projectPath, "package.json");
		const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));
		packageJson.name = projectName;
		await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
		s.stop("Project configured");

		s.start("Installing dependencies...");
		await execAsync("bun install", { cwd: projectPath });
		s.stop("Dependencies installed");

		s.start("Initializing git...");
		await execAsync("git init", { cwd: projectPath });
		await execAsync("git add .", { cwd: projectPath });
		await execAsync('git commit -m "init: initial file upload"', {
			cwd: projectPath,
		});
		s.stop("Git initialized");

		clack.outro(`Project ${projectName} is ready`);

		console.log(`\nNext steps:
  cd ${projectName}
  bun run dev
`);
	} catch (error) {
		s.stop("Error occurred");
		clack.log.error(error.message);
		clack.cancel("Setup failed");
		process.exit(1);
	}
}

main().catch(console.error);
