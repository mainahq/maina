/**
 * Syntax Guard — the first gate in the Verify Engine pipeline.
 *
 * Runs Biome check on the provided files and returns structured errors.
 * If syntax fails, the pipeline rejects immediately — no tests, no coverage,
 * no slop detection. This must complete in <500ms for 10 files.
 *
 * Uses `--reporter=json` for machine-parseable output.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";
import type { LanguageProfile } from "../language/profile";
import { TYPESCRIPT_PROFILE } from "../language/profile";
import { parseClippyOutput } from "./linters/clippy";
import { parseGoVetOutput } from "./linters/go-vet";
import { parseRuffOutput } from "./linters/ruff";

export interface SyntaxDiagnostic {
	file: string;
	line: number;
	column: number;
	message: string;
	severity: "error" | "warning";
}

export type SyntaxGuardResult = Result<void, SyntaxDiagnostic[]>;

/** Shape of a single diagnostic in Biome's JSON reporter output. */
interface BiomeDiagnostic {
	severity: string;
	message: string;
	category: string;
	location: {
		path: string;
		start: { line: number; column: number };
		end: { line: number; column: number };
	};
	advices: unknown[];
}

/** Shape of Biome's JSON reporter output. */
interface BiomeJsonOutput {
	summary: {
		changed: number;
		unchanged: number;
		errors: number;
		warnings: number;
	};
	diagnostics: BiomeDiagnostic[];
	command: string;
}

/**
 * Find the biome binary — prefer local node_modules/.bin, fall back to global.
 */
function findBiomeBinary(cwd: string): string {
	const localBin = join(cwd, "node_modules", ".bin", "biome");
	if (existsSync(localBin)) {
		return localBin;
	}

	// Walk up to find node_modules/.bin
	let dir = cwd;
	const root = "/";
	while (dir !== root) {
		const binPath = join(dir, "node_modules", ".bin", "biome");
		if (existsSync(binPath)) {
			return binPath;
		}
		const parent = join(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}

	// Fall back to bare "biome" (assumes it's on PATH)
	return "biome";
}

/**
 * Parse Biome's JSON reporter output into structured SyntaxDiagnostic[].
 * Returns an empty array if the output cannot be parsed.
 */
export function parseBiomeOutput(output: string): SyntaxDiagnostic[] {
	try {
		const parsed: BiomeJsonOutput = JSON.parse(output);
		if (!parsed.diagnostics || !Array.isArray(parsed.diagnostics)) {
			return [];
		}

		return parsed.diagnostics
			.filter(
				(d) =>
					d.location?.path &&
					d.location?.start &&
					typeof d.location.start.line === "number",
			)
			.map((d) => ({
				file: d.location.path,
				line: d.location.start.line,
				column: d.location.start.column,
				message: d.message,
				severity:
					d.severity === "error" ? ("error" as const) : ("warning" as const),
			}));
	} catch {
		return [];
	}
}

/**
 * Run Biome check on the provided files and return a Result.
 *
 * - If no files are provided, returns Ok immediately.
 * - If Biome exits with code 0, returns Ok.
 * - If Biome exits non-zero, parses errors and returns Err if any errors exist.
 * - Only errors (not warnings) trigger a rejection.
 */
export async function syntaxGuard(
	files: string[],
	cwd?: string,
	profile?: LanguageProfile,
): Promise<SyntaxGuardResult> {
	if (files.length === 0) {
		return { ok: true, value: undefined };
	}

	const lang = profile ?? TYPESCRIPT_PROFILE;
	const workDir = cwd ?? process.cwd();

	// Route to language-specific linter for non-TypeScript
	if (lang.id !== "typescript") {
		return runLanguageLinter(files, workDir, lang);
	}
	const biomeBin = findBiomeBinary(workDir);

	try {
		const proc = Bun.spawn(
			[
				biomeBin,
				"check",
				"--reporter=json",
				"--no-errors-on-unmatched",
				"--colors=off",
				...files,
			],
			{
				cwd: workDir,
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		if (exitCode === 0) {
			return { ok: true, value: undefined };
		}

		// Parse diagnostics from JSON output
		const allDiagnostics = parseBiomeOutput(stdout);

		// Only reject on errors, not warnings
		const errors = allDiagnostics.filter((d) => d.severity === "error");

		if (errors.length === 0) {
			// Only warnings — pass
			return { ok: true, value: undefined };
		}

		// Return all diagnostics (errors + warnings) for context,
		// but the presence of errors triggers the rejection.
		return { ok: false, error: allDiagnostics };
	} catch (e) {
		// Biome not found or spawn failure
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: [
				{
					file: "",
					line: 0,
					column: 0,
					message: `Failed to run biome: ${message}`,
					severity: "error",
				},
			],
		};
	}
}

/**
 * Run a language-specific linter and return structured diagnostics.
 * Gracefully handles tool-not-found by returning an error diagnostic.
 */
async function runLanguageLinter(
	files: string[],
	cwd: string,
	profile: LanguageProfile,
): Promise<SyntaxGuardResult> {
	const args = profile.syntaxArgs(files, cwd);

	try {
		const proc = Bun.spawn(args, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		await proc.exited;

		let diagnostics: SyntaxDiagnostic[] = [];

		switch (profile.id) {
			case "python":
				diagnostics = parseRuffOutput(stdout);
				break;
			case "go":
				diagnostics = parseGoVetOutput(stderr);
				break;
			case "rust":
				diagnostics = parseClippyOutput(stdout);
				break;
		}

		const errors = diagnostics.filter((d) => d.severity === "error");
		if (errors.length === 0) {
			return { ok: true, value: undefined };
		}

		return { ok: false, error: diagnostics };
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			error: [
				{
					file: "",
					line: 0,
					column: 0,
					message: `Failed to run ${profile.syntaxTool}: ${message}`,
					severity: "error",
				},
			],
		};
	}
}
