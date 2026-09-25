/**
 * Built-in Type Checking — runs language-native type checkers as a verify step.
 *
 * Zero external tool install required for TypeScript projects (uses project's tsc).
 * For other languages: mypy (Python), go vet (Go), cargo check (Rust),
 * dotnet build (C#), javac (Java).
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LanguageId } from "../language/profile";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface TypecheckResult {
	findings: Finding[];
	duration: number;
	tool: string;
	skipped: boolean;
}

export interface TypecheckCommand {
	tool: string;
	command: string;
	args: string[];
	configFile?: string;
}

// ─── Language-specific commands ───────────────────────────────────────────

const TYPECHECK_COMMANDS: Record<LanguageId, TypecheckCommand> = {
	typescript: {
		tool: "tsc",
		command: "tsc",
		args: ["--noEmit", "--pretty", "false"],
		configFile: "tsconfig.json",
	},
	python: {
		tool: "mypy",
		command: "mypy",
		args: ["--no-color-output", "--no-error-summary"],
	},
	go: {
		tool: "go-vet",
		command: "go",
		args: ["vet", "./..."],
	},
	rust: {
		tool: "cargo-check",
		command: "cargo",
		args: ["check", "--message-format=short"],
	},
	csharp: {
		tool: "dotnet-build",
		command: "dotnet",
		args: ["build", "--no-restore", "--verbosity", "quiet"],
	},
	java: {
		tool: "javac",
		command: "javac",
		args: ["-Xlint:all"],
	},
	php: {
		tool: "phpstan",
		command: "phpstan",
		args: ["analyse", "--error-format=json", "--no-progress"],
	},
};

export function getTypecheckCommand(language: LanguageId): TypecheckCommand {
	return TYPECHECK_COMMANDS[language];
}

// ─── TSC Output Parser ───────────────────────────────────────────────────

/**
 * Parse tsc --noEmit --pretty false output into Finding[].
 *
 * Format: file(line,col): error TSxxxx: message
 */
export function parseTscOutput(output: string): Finding[] {
	if (!output.trim()) return [];

	const findings: Finding[] = [];
	const pattern =
		/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;

	for (const match of output.matchAll(pattern)) {
		findings.push({
			tool: "tsc",
			file: match[1] ?? "",
			line: Number.parseInt(match[2] ?? "0", 10),
			column: Number.parseInt(match[3] ?? "0", 10),
			message: `${match[5] ?? ""}: ${match[6] ?? ""}`,
			severity: match[4] === "error" ? "error" : "warning",
			ruleId: match[5] ?? "",
		});
	}

	return findings;
}

// ─── Workspace projects (#374) ───────────────────────────────────────────

const TS_FILE = /\.(c|m)?tsx?$/;

/**
 * Group repo-relative TypeScript files by the directory of their nearest
 * `tsconfig.json` (walking up to, and including, `root`). "" is the root
 * project. Files with no tsconfig are dropped. Pure given `exists`.
 */
export function groupFilesByProject(
	files: readonly string[],
	root: string,
	exists: (absPath: string) => boolean,
): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const file of files) {
		if (!TS_FILE.test(file)) continue;
		let dir = dirname(file);
		for (;;) {
			const rel = dir === "." ? "" : dir;
			if (exists(join(root, rel, "tsconfig.json"))) {
				groups.set(rel, [...(groups.get(rel) ?? []), file]);
				break;
			}
			if (rel === "") break;
			dir = dirname(dir);
		}
	}
	return groups;
}

/** Prefix project-relative finding paths with the project directory. */
export function rebaseFindings(
	findings: readonly Finding[],
	projectDir: string,
): Finding[] {
	if (projectDir === "") return [...findings];
	return findings.map((f) => ({ ...f, file: join(projectDir, f.file) }));
}

/** Nearest node_modules/.bin/<command> from `dir` up to `root`, else the bare command. */
function resolveLocalBin(command: string, dir: string, root: string): string {
	let current = dir;
	for (;;) {
		const bin = join(current, "node_modules", ".bin", command);
		if (existsSync(bin)) return bin;
		if (current === root || dirname(current) === current) return command;
		current = dirname(current);
	}
}

async function runTscProject(
	projectDir: string,
	root: string,
): Promise<{ findings: Finding[]; ran: boolean }> {
	const cwd = join(root, projectDir);
	const command = resolveLocalBin("tsc", cwd, root);
	try {
		const proc = Bun.spawn(
			[command, "-p", ".", "--noEmit", "--pretty", "false"],
			{
				cwd,
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, NO_COLOR: "1" },
			},
		);
		const output =
			(await new Response(proc.stdout).text()) +
			(await new Response(proc.stderr).text());
		await proc.exited;
		return {
			findings: rebaseFindings(parseTscOutput(output), projectDir),
			ran: true,
		};
	} catch {
		return { findings: [], ran: false };
	}
}

// ─── Runner ──────────────────────────────────────────────────────────────

export async function runTypecheck(
	files: string[],
	cwd: string,
	options?: { command?: string; language?: LanguageId },
): Promise<TypecheckResult> {
	const language = options?.language ?? "typescript";
	const cmd = TYPECHECK_COMMANDS[language];
	const start = performance.now();

	// Workspace-aware TypeScript: one `tsc -p` per nearest tsconfig of the
	// changed files, so package-local types and deps resolve (#374).
	if (language === "typescript" && !options?.command && files.length > 0) {
		const groups = groupFilesByProject(files, cwd, existsSync);
		if (groups.size > 0) {
			const runs = await Promise.all(
				[...groups.keys()].map((dir) => runTscProject(dir, cwd)),
			);
			return {
				findings: runs.flatMap((r) => r.findings),
				duration: performance.now() - start,
				tool: cmd.tool,
				skipped: !runs.some((r) => r.ran),
			};
		}
	}

	// Check config file exists (e.g., tsconfig.json for TS)
	if (cmd.configFile && !existsSync(join(cwd, cmd.configFile))) {
		return {
			findings: [],
			duration: performance.now() - start,
			tool: cmd.tool,
			skipped: true,
		};
	}

	// Resolve command: check node_modules/.bin first (for tsc, mypy, etc.)
	const localBin = join(cwd, "node_modules", ".bin", cmd.command);
	const command =
		options?.command ?? (existsSync(localBin) ? localBin : cmd.command);

	try {
		const proc = Bun.spawn([command, ...cmd.args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, NO_COLOR: "1" },
		});

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		await proc.exited;

		const output = stdout + stderr;
		let findings: Finding[];

		if (language === "typescript") {
			findings = parseTscOutput(output);
		} else {
			// For other languages, treat any non-zero exit as a generic finding
			findings =
				proc.exitCode !== 0 && output.trim()
					? [
							{
								tool: cmd.tool,
								file: files[0] ?? "unknown",
								line: 1,
								message: output.trim().split("\n")[0] ?? "Type check failed",
								severity: "error" as const,
							},
						]
					: [];
		}

		return {
			findings,
			duration: performance.now() - start,
			tool: cmd.tool,
			skipped: false,
		};
	} catch {
		// Command not found or other spawn error
		return {
			findings: [],
			duration: performance.now() - start,
			tool: cmd.tool,
			skipped: true,
		};
	}
}
