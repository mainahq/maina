/**
 * Built-in Type Checking — runs language-native type checkers as a verify step.
 *
 * Zero external tool install required for TypeScript projects (uses project's tsc).
 * For other languages: mypy (Python), go vet (Go), cargo check (Rust),
 * dotnet build (C#), javac (Java).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
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

// ─── Runner ──────────────────────────────────────────────────────────────

export async function runTypecheck(
	files: string[],
	cwd: string,
	options?: { command?: string; language?: LanguageId },
): Promise<TypecheckResult> {
	const language = options?.language ?? "typescript";
	const cmd = TYPECHECK_COMMANDS[language];
	const start = performance.now();

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
