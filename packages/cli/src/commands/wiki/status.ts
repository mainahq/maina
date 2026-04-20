/**
 * `maina wiki status` — quick health dashboard for the wiki.
 *
 * Shows initialization state, article counts by type, coverage,
 * stale article count, and last compilation timestamp.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { loadWikiState } from "@mainahq/core";
import type { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WikiStatusResult {
	initialized: boolean;
	articlesByType: Record<string, number>;
	totalArticles: number;
	coveragePercent: number;
	staleCount: number;
	lastCompile: string;
}

export interface WikiStatusOptions {
	json?: boolean;
	cwd?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ARTICLE_TYPES = [
	"modules",
	"entities",
	"features",
	"decisions",
	"architecture",
	"raw",
];

/**
 * Count stale articles — articles whose on-disk markdown has drifted from the
 * hash recorded at compile time. For each entry in `state.articleHashes`, read
 * the article file and compare its hash to the recorded one. A missing file or
 * a hash mismatch counts as stale.
 *
 * Article keys in state are of the form `wiki/modules/foo.md`; on disk the files
 * live at `<wikiDir>/modules/foo.md`. The leading `wiki/` segment must be stripped
 * before joining against wikiDir — otherwise every article appears stale because
 * the lookup path `<wikiDir>/wiki/modules/foo.md` never exists (#211).
 */
function countStaleArticles(
	wikiDir: string,
	state: { articleHashes: Record<string, string> },
): number {
	let staleCount = 0;

	for (const [articlePath, expectedHash] of Object.entries(
		state.articleHashes,
	)) {
		const onDiskPath = articlePath.replace(/^wiki\//, "");
		const fullPath = join(wikiDir, onDiskPath);
		if (!existsSync(fullPath)) {
			staleCount++;
			continue;
		}
		try {
			const { hashContent } = require("@mainahq/core");
			const content = readFileSync(fullPath, "utf-8");
			const currentHash = hashContent(content);
			if (currentHash !== expectedHash) {
				staleCount++;
			}
		} catch {
			// skip
		}
	}

	return staleCount;
}

// ── Core Action (testable) ──────────────────────────────────────────────────

export async function wikiStatusAction(
	options: WikiStatusOptions = {},
): Promise<WikiStatusResult> {
	const cwd = options.cwd ?? process.cwd();
	const wikiDir = join(cwd, ".maina", "wiki");

	// Check initialization
	if (!existsSync(wikiDir)) {
		return {
			initialized: false,
			articlesByType: {},
			totalArticles: 0,
			coveragePercent: 0,
			staleCount: 0,
			lastCompile: "",
		};
	}

	// Count articles by type
	const articlesByType: Record<string, number> = {};
	let totalArticles = 0;

	for (const subdir of ARTICLE_TYPES) {
		const dir = join(wikiDir, subdir);
		let count = 0;
		if (existsSync(dir)) {
			try {
				const entries = readdirSync(dir);
				count = entries.filter((e) => e.endsWith(".md")).length;
			} catch {
				// skip
			}
		}
		articlesByType[subdir] = count;
		totalArticles += count;
	}

	// Load state for metadata
	const state = loadWikiState(wikiDir);
	const lastCompile =
		state?.lastFullCompile ?? state?.lastIncrementalCompile ?? "";

	// Count stale articles
	const staleCount = state ? countStaleArticles(wikiDir, state) : 0;

	// Coverage: estimate from file hashes vs source files
	const fileHashCount = state ? Object.keys(state.fileHashes).length : 0;
	const articleHashCount = state ? Object.keys(state.articleHashes).length : 0;
	const coveragePercent =
		fileHashCount > 0
			? Math.round((articleHashCount / fileHashCount) * 100)
			: 0;

	return {
		initialized: true,
		articlesByType,
		totalArticles,
		coveragePercent: Math.min(coveragePercent, 100),
		staleCount,
		lastCompile,
	};
}

// ── Formatting ──────────────────────────────────────────────────────────────

function formatStatusTable(result: WikiStatusResult): string {
	const lines: string[] = [];

	if (!result.initialized) {
		lines.push("  Wiki not initialized. Run `maina wiki init` to get started.");
		return lines.join("\n");
	}

	lines.push(`  ${"Type".padEnd(16)} Count`);
	lines.push(`  ${"─".repeat(16)} ${"─".repeat(6)}`);

	for (const [type, count] of Object.entries(result.articlesByType)) {
		lines.push(`  ${type.padEnd(16)} ${count}`);
	}

	lines.push(`  ${"─".repeat(16)} ${"─".repeat(6)}`);
	lines.push(`  ${"Total".padEnd(16)} ${result.totalArticles}`);
	lines.push("");
	lines.push(`  Coverage:       ${result.coveragePercent}%`);
	lines.push(`  Stale:          ${result.staleCount}`);
	if (result.lastCompile) {
		lines.push(`  Last compile:   ${result.lastCompile}`);
	}

	return lines.join("\n");
}

// ── Commander Command ────────────────────────────────────────────────────────

export function wikiStatusCommand(parent: Command): void {
	parent
		.command("status")
		.description("Show wiki health dashboard")
		.option("--json", "Output JSON for CI")
		.action(async (options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina wiki status");
			}

			const result = await wikiStatusAction({ json: jsonMode });

			if (!jsonMode) {
				log.step("Wiki Status:");
				log.message(formatStatusTable(result));
				outro("Done.");
			} else {
				outputJson(result, EXIT_PASSED);
			}
		});
}
