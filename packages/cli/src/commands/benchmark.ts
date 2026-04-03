import { join } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import { Command } from "commander";

// ── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkActionOptions {
	story?: string;
	list?: boolean;
	pipeline?: "maina" | "speckit";
	cwd?: string;
}

export interface BenchmarkActionResult {
	ran: boolean;
	listed?: boolean;
	reason?: string;
	reportJson?: string;
	reportText?: string;
}

export interface BenchmarkDeps {
	listStories: typeof import("@maina/core").listStories;
	loadStory: typeof import("@maina/core").loadStory;
	runBenchmark: typeof import("@maina/core").runBenchmark;
	buildReport: typeof import("@maina/core").buildReport;
	formatComparison: typeof import("@maina/core").formatComparison;
}

// ── Default Dependencies ─────────────────────────────────────────────────────

let defaultDeps: BenchmarkDeps | null = null;

async function getDefaultDeps(): Promise<BenchmarkDeps> {
	if (defaultDeps) return defaultDeps;
	const core = await import("@maina/core");
	defaultDeps = {
		listStories: core.listStories,
		loadStory: core.loadStory,
		runBenchmark: core.runBenchmark,
		buildReport: core.buildReport,
		formatComparison: core.formatComparison,
	};
	return defaultDeps;
}

// ── Core Action (testable) ───────────────────────────────────────────────────

export async function benchmarkAction(
	options: BenchmarkActionOptions,
	deps?: BenchmarkDeps,
): Promise<BenchmarkActionResult> {
	const d = deps ?? (await getDefaultDeps());
	const cwd = options.cwd ?? process.cwd();
	const storiesDir = join(cwd, ".maina", "benchmarks", "stories");

	// ── List mode ────────────────────────────────────────────────────────
	if (options.list) {
		const result = d.listStories(storiesDir);
		if (!result.ok) {
			return { ran: false, listed: false, reason: result.error };
		}

		return { ran: false, listed: true };
	}

	// ── Run mode ─────────────────────────────────────────────────────────
	if (!options.story) {
		return {
			ran: false,
			reason: "No story specified. Use --story <name> or --list.",
		};
	}

	const storyResult = d.loadStory(storiesDir, options.story);
	if (!storyResult.ok) {
		return { ran: false, reason: storyResult.error };
	}

	const story = storyResult.value;
	const pipeline = options.pipeline ?? "maina";
	const testPaths = story.config.testFiles.map((f) => join(story.storyDir, f));

	const runResult = await d.runBenchmark({
		pipeline,
		storyName: story.config.name,
		testFiles: testPaths,
		implDir: story.storyDir,
	});

	if (!runResult.ok) {
		return { ran: false, reason: runResult.error };
	}

	const report = d.buildReport(
		story.config,
		pipeline === "maina" ? runResult.value : null,
		pipeline === "speckit" ? runResult.value : null,
	);

	return {
		ran: true,
		reportJson: JSON.stringify(report, null, 2),
		reportText: d.formatComparison(report),
	};
}

// ── Commander Command ────────────────────────────────────────────────────────

export function benchmarkCommand(): Command {
	return new Command("benchmark")
		.description("Run benchmark comparing Spec Kit vs Maina")
		.option("-s, --story <name>", "Story name to benchmark")
		.option("--list", "List available benchmark stories")
		.option(
			"-p, --pipeline <pipeline>",
			"Pipeline to run (maina or speckit)",
			"maina",
		)
		.action(async (options) => {
			intro("maina benchmark");

			const result = await benchmarkAction({
				story: options.story,
				list: options.list,
				pipeline: options.pipeline as "maina" | "speckit",
			});

			if (result.listed) {
				outro("Done.");
			} else if (result.ran) {
				if (result.reportText) {
					log.info(result.reportText);
				}
				outro("Benchmark complete.");
			} else {
				log.error(result.reason ?? "Unknown error");
				outro("Aborted.");
			}
		});
}
