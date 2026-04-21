/**
 * `maina wiki status` — quick health dashboard for the wiki.
 *
 * Shows initialization state, article counts by type, coverage,
 * stale article count, last compilation timestamp, and — when a
 * `wiki init --background` compile is in flight — a progress line
 * with percent complete + ETA (Wave 4 / G9).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { loadWikiState } from "@mainahq/core";
import type { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WikiProgress {
	startedAt: string;
	percent: number;
	etaSeconds: number;
	stage: string;
	/**
	 * True when the progress record has not been updated in more than
	 * STALE_THRESHOLD_MS. Surfaced so UIs can render a "stalled" hint
	 * rather than a live spinner for a dead background compile.
	 */
	stale: boolean;
}

export interface WikiStatusResult {
	initialized: boolean;
	articlesByType: Record<string, number>;
	totalArticles: number;
	coveragePercent: number;
	staleCount: number;
	lastCompile: string;
	progress: WikiProgress | null;
}

export interface WikiStatusOptions {
	json?: boolean;
	cwd?: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const ARTICLE_TYPES = [
	"modules",
	"entities",
	"features",
	"decisions",
	"architecture",
	"raw",
];

/** A progress file older than 10 minutes is considered stalled. */
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

// ── Progress loading ────────────────────────────────────────────────────────

/**
 * Read `.maina/wiki/.progress.json` if it exists.
 *
 * Returns `null` when the file is missing, unparseable, or the run has
 * already completed (`percent === 100`). A non-null result means a
 * background compile is either still running or stalled — caller
 * inspects `stale` to tell the two apart.
 */
function loadProgress(wikiDir: string): WikiProgress | null {
	const path = join(wikiDir, ".progress.json");
	if (!existsSync(path)) return null;
	let raw: string;
	let mtimeMs: number;
	try {
		raw = readFileSync(path, "utf-8");
		mtimeMs = statSync(path).mtimeMs;
	} catch {
		return null;
	}
	let parsed: {
		startedAt?: unknown;
		percent?: unknown;
		etaSeconds?: unknown;
		stage?: unknown;
	};
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	const startedAt =
		typeof parsed.startedAt === "string" ? parsed.startedAt : null;
	const percent = typeof parsed.percent === "number" ? parsed.percent : null;
	if (startedAt === null || percent === null) return null;
	if (percent >= 100) return null;

	const etaSeconds =
		typeof parsed.etaSeconds === "number" ? parsed.etaSeconds : 0;
	const stage = typeof parsed.stage === "string" ? parsed.stage : "compiling";

	// Staleness is progress-freshness, not run age: a 30-minute compile whose
	// progress file is rewritten every few seconds is NOT stalled. We read the
	// file's mtime instead of `startedAt` so long-running jobs aren't
	// prematurely marked dead.
	const stale = Date.now() - mtimeMs > STALE_THRESHOLD_MS;

	return { startedAt, percent, etaSeconds, stage, stale };
}

// ── Stale-article accounting ────────────────────────────────────────────────

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
			progress: null,
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

	// Background-compile progress (G9)
	const progress = loadProgress(wikiDir);

	return {
		initialized: true,
		articlesByType,
		totalArticles,
		coveragePercent: Math.min(coveragePercent, 100),
		staleCount,
		lastCompile,
		progress,
	};
}

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Render a one-line summary of an in-flight background compile. Exported
 * so both the CLI renderer and the tests can share the exact formatting
 * rules.
 */
export function formatProgressLine(progress: WikiProgress): string {
	if (progress.stale) {
		return `  Compile stalled — ${progress.percent}% at '${progress.stage}' (no update in 10+ min). Re-run \`maina wiki init\`.`;
	}
	const eta = progress.etaSeconds > 0 ? `ETA ${progress.etaSeconds}s` : "";
	const tail = eta !== "" ? ` (${eta})` : "";
	return `  Compiling… ${progress.percent}% — ${progress.stage}${tail}`;
}

function formatStatusTable(result: WikiStatusResult): string {
	const lines: string[] = [];

	if (!result.initialized) {
		lines.push("  Wiki not initialized. Run `maina wiki init` to get started.");
		return lines.join("\n");
	}

	if (result.progress !== null) {
		lines.push(formatProgressLine(result.progress));
		lines.push("");
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
