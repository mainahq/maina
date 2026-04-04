import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import {
	createCacheManager,
	detectSlop,
	type Finding,
	getStagedFiles,
	getTrackedFiles,
} from "@maina/core";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SlopActionOptions {
	all?: boolean;
	json?: boolean;
	cwd?: string;
}

export interface SlopActionResult {
	findingsCount: number;
	findings: Finding[];
	json?: string;
}

// ── Formatting ──────────────────────────────────────────────────────────────

function formatFindings(findings: Finding[]): string {
	if (findings.length === 0) return "  No slop detected.";
	const header = `  ${"File".padEnd(30)} ${"Line".padStart(5)}  ${"Rule".padEnd(24)}  Message`;
	const separator = `  ${"─".repeat(30)} ${"─".repeat(5)}  ${"─".repeat(24)}  ${"─".repeat(30)}`;
	const rows = findings.map((f) => {
		const file =
			f.file.length > 28 ? `…${f.file.slice(f.file.length - 27)}` : f.file;
		const rule = f.ruleId ?? "slop";
		return `  ${file.padEnd(30)} ${String(f.line).padStart(5)}  ${rule.padEnd(24)}  ${f.message}`;
	});
	return [header, separator, ...rows].join("\n");
}

// ── Core Action (testable) ──────────────────────────────────────────────────

export async function slopAction(
	options: SlopActionOptions,
): Promise<SlopActionResult> {
	const cwd = options.cwd ?? process.cwd();
	const mainaDir = join(cwd, ".maina");

	// Get files to check
	const files = options.all
		? await getTrackedFiles(cwd)
		: await getStagedFiles(cwd);

	if (files.length === 0) {
		return { findingsCount: 0, findings: [] };
	}

	const cache = createCacheManager(mainaDir);
	const result = await detectSlop(files, { cwd, cache });

	const slopResult: SlopActionResult = {
		findingsCount: result.findings.length,
		findings: result.findings,
	};

	if (options.json) {
		slopResult.json = JSON.stringify(
			{
				findings: result.findings,
				count: result.findings.length,
				cached: result.cached,
			},
			null,
			2,
		);
	}

	return slopResult;
}

// ── Commander Command ────────────────────────────────────────────────────────

export function slopCommand(): Command {
	return new Command("slop")
		.description("Check for AI-generated slop patterns")
		.option("--all", "Scan all tracked files, not just staged")
		.option("--json", "Output JSON")
		.action(async (options) => {
			intro("maina slop");

			const s = spinner();
			s.start("Checking for slop patterns…");

			const result = await slopAction({
				all: options.all,
				json: options.json,
			});

			s.stop("Slop check complete.");

			if (result.json) {
				process.stdout.write(`${result.json}\n`);
			} else {
				log.message(formatFindings(result.findings));
			}

			if (result.findingsCount === 0) {
				outro("No slop detected.");
			} else {
				outro(
					`${result.findingsCount} slop pattern${result.findingsCount > 1 ? "s" : ""} found.`,
				);
			}
		});
}
