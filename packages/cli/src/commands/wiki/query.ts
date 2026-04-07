/**
 * `maina wiki query <question>` — AI-powered wiki search and synthesis.
 *
 * Uses the core queryWiki() to score articles by keyword relevance,
 * then synthesizes an answer via AI. Falls back to keyword excerpts
 * when AI is unavailable.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { intro, log, outro, spinner } from "@clack/prompts";
import type { Command } from "commander";
import { EXIT_PASSED, outputJson } from "../../json";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WikiQueryResult {
	answer: string;
	sources: string[];
	cached: boolean;
}

export interface WikiQueryOptions {
	save?: boolean;
	json?: boolean;
	cwd?: string;
}

// ── Core Action (testable) ──────────────────────────────────────────────────

export async function wikiQueryAction(
	question: string,
	options: WikiQueryOptions = {},
): Promise<WikiQueryResult> {
	const cwd = options.cwd ?? process.cwd();
	const wikiDir = join(cwd, ".maina", "wiki");

	// Delegate to core queryWiki
	const { queryWiki } = await import("@mainahq/core");
	const result = await queryWiki({
		wikiDir,
		question,
		maxArticles: 10,
		repoRoot: cwd,
	});

	if (!result.ok) {
		return {
			answer: result.error,
			sources: [],
			cached: false,
		};
	}

	const queryResult = result.value;

	// Optionally save the query result
	if (options.save && queryResult.sources.length > 0) {
		const rawDir = join(wikiDir, "raw");
		if (!existsSync(rawDir)) {
			mkdirSync(rawDir, { recursive: true });
		}
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const queryFile = join(rawDir, `query-${timestamp}.md`);
		const queryContent = [
			`# Query: ${question}`,
			"",
			queryResult.answer,
			"",
			"## Sources",
			"",
			...queryResult.sources.map((s: string) => `- ${s}`),
		].join("\n");
		writeFileSync(queryFile, queryContent);
	}

	return queryResult;
}

// ── Commander Command ────────────────────────────────────────────────────────

export function wikiQueryCommand(parent: Command): void {
	parent
		.command("query <question>")
		.description("Search wiki articles and synthesize an answer")
		.option("--save", "Save query results to wiki/raw/")
		.option("--json", "Output JSON for CI")
		.action(async (question: string, options) => {
			const jsonMode = options.json ?? false;

			if (!jsonMode) {
				intro("maina wiki query");
			}

			const s = spinner();
			if (!jsonMode) {
				s.start("Searching wiki...");
			}

			const result = await wikiQueryAction(question, { json: jsonMode });

			if (!jsonMode) {
				s.stop("Search complete.");
				log.message(result.answer);
				if (result.sources.length > 0) {
					log.info(`Sources: ${result.sources.join(", ")}`);
				}
				outro("Done.");
			} else {
				outputJson(result, EXIT_PASSED);
			}
		});
}
