/**
 * Lighthouse Integration for the Verify Engine.
 *
 * Runs Google Lighthouse against a URL and checks category scores
 * against configurable thresholds.
 * Generates findings when scores fall below thresholds.
 * Gracefully skips if lighthouse is not installed.
 */

import { isToolAvailable } from "./detect";
import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface LighthouseOptions {
	url: string;
	cwd: string;
	/** Pre-resolved availability — skips redundant detection if provided. */
	available?: boolean;
	/** Score thresholds (0-100). Categories below threshold generate findings. */
	thresholds?: Record<string, number>;
}

export interface LighthouseResult {
	findings: Finding[];
	skipped: boolean;
	scores: Record<string, number>;
}

/** Default thresholds — 90 for the three core categories. */
const DEFAULT_THRESHOLDS: Record<string, number> = {
	performance: 90,
	accessibility: 90,
	seo: 90,
};

// ─── JSON Parsing ─────────────────────────────────────────────────────────

/**
 * Determine severity based on how far below the threshold a score is.
 * Below 50: error. Below threshold: warning.
 */
function scoreSeverity(
	score: number,
	_threshold: number,
): "error" | "warning" | "info" {
	if (score < 50) {
		return "error";
	}
	return "warning";
}

/**
 * Parse Lighthouse JSON output into findings and scores.
 *
 * Lighthouse JSON has this structure:
 * ```json
 * {
 *   "requestedUrl": "https://example.com",
 *   "categories": {
 *     "performance": { "score": 0.95 },
 *     "accessibility": { "score": 0.88 },
 *     "seo": { "score": 0.92 },
 *     "best-practices": { "score": 0.85 }
 *   }
 * }
 * ```
 *
 * Scores are 0-1 floats. We multiply by 100 for human-readable percentages.
 * Findings are generated for categories whose scores fall below the thresholds.
 *
 * Handles malformed JSON and unexpected structures gracefully.
 */
export function parseLighthouseJson(
	json: string,
	thresholds?: Record<string, number>,
): Omit<LighthouseResult, "skipped"> {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(json) as Record<string, unknown>;
	} catch {
		return { findings: [], scores: {} };
	}

	const categories = parsed.categories;
	if (typeof categories !== "object" || categories === null) {
		return { findings: [], scores: {} };
	}

	const requestedUrl = (parsed.requestedUrl as string) ?? "";
	const activeThresholds = thresholds ?? DEFAULT_THRESHOLDS;
	const scores: Record<string, number> = {};
	const findings: Finding[] = [];

	const cats = categories as Record<string, unknown>;

	for (const [categoryName, categoryData] of Object.entries(cats)) {
		const cat = categoryData as Record<string, unknown> | null;
		if (!cat || typeof cat.score !== "number") {
			continue;
		}

		const rawScore = cat.score as number;
		const score = Math.round(rawScore * 100);
		scores[categoryName] = score;

		const threshold = activeThresholds[categoryName];
		if (threshold !== undefined && score < threshold) {
			findings.push({
				tool: "lighthouse",
				file: requestedUrl,
				line: 0,
				message: `Lighthouse ${categoryName} score ${score} is below threshold ${threshold}`,
				severity: scoreSeverity(score, threshold),
				ruleId: `lighthouse/${categoryName}`,
			});
		}
	}

	return { findings, scores };
}

// ─── Runner ───────────────────────────────────────────────────────────────

/**
 * Run Lighthouse and return parsed findings with scores.
 *
 * If lighthouse is not installed or no URL is provided,
 * returns `{ findings: [], skipped: true, scores: {} }`.
 * If lighthouse fails, returns `{ findings: [], skipped: false, scores: {} }`.
 */
export async function runLighthouse(
	options: LighthouseOptions,
): Promise<LighthouseResult> {
	if (!options.url) {
		return { findings: [], skipped: true, scores: {} };
	}

	const toolAvailable =
		options.available ?? (await isToolAvailable("lighthouse"));
	if (!toolAvailable) {
		return { findings: [], skipped: true, scores: {} };
	}

	const cwd = options.cwd;

	const args = [
		"lighthouse",
		options.url,
		"--output=json",
		'--chrome-flags="--headless --no-sandbox"',
	];

	try {
		const proc = Bun.spawn(args, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		await new Response(proc.stderr).text();
		await proc.exited;

		const { findings, scores } = parseLighthouseJson(
			stdout,
			options.thresholds,
		);
		return { findings, skipped: false, scores };
	} catch {
		return { findings: [], skipped: false, scores: {} };
	}
}
