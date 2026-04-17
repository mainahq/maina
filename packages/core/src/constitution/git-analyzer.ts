/**
 * Git-log + CI Analyzer — extract conventions from git history and CI config.
 *
 * Detects:
 * - Conventional Commits usage rate
 * - Hot paths (top 20 churn files)
 * - Required CI checks from .github/workflows/*.yml
 * - Branch protection hints from CODEOWNERS
 *
 * Emits constitution rules with confidence scores.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ConstitutionRule {
	text: string;
	confidence: number;
	source: string;
}

/**
 * Analyze git log for conventional commit usage.
 * Returns a rule if >50% of recent commits follow conventional format.
 */
export async function analyzeCommitConventions(
	repoRoot: string,
	limit = 100,
): Promise<ConstitutionRule[]> {
	const rules: ConstitutionRule[] = [];

	try {
		const proc = Bun.spawn(
			["git", "log", `--max-count=${limit}`, "--format=%s"],
			{ cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
		);
		const output = await new Response(proc.stdout).text();
		await proc.exited;

		const messages = output.trim().split("\n").filter(Boolean);
		if (messages.length === 0) return rules;

		// Conventional commit pattern: type(scope): description or type: description
		const conventionalPattern =
			/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:\s/;
		const conventionalCount = messages.filter((m) =>
			conventionalPattern.test(m),
		).length;
		const rate = conventionalCount / messages.length;

		if (rate > 0.5) {
			// Extract common scopes
			const scopes = new Set<string>();
			for (const msg of messages) {
				const match = msg.match(/^\w+\(([^)]+)\):/);
				if (match?.[1]) scopes.add(match[1]);
			}

			const scopeList =
				scopes.size > 0
					? ` Scopes: ${[...scopes].slice(0, 10).join(", ")}`
					: "";
			rules.push({
				text: `Conventional commits enforced (${Math.round(rate * 100)}% adoption).${scopeList}`,
				confidence: Math.min(1.0, rate + 0.1),
				source: `git log (last ${messages.length} commits)`,
			});
		}
	} catch {
		// Not a git repo or git not available
	}

	return rules;
}

/**
 * Find the top N most-changed files (churn hotspots).
 */
export async function analyzeHotPaths(
	repoRoot: string,
	topN = 20,
): Promise<ConstitutionRule[]> {
	const rules: ConstitutionRule[] = [];

	try {
		const proc = Bun.spawn(
			["git", "log", "--max-count=500", "--name-only", "--format="],
			{ cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
		);
		const output = await new Response(proc.stdout).text();
		await proc.exited;

		const files = output.trim().split("\n").filter(Boolean);
		const counts = new Map<string, number>();
		for (const f of files) {
			counts.set(f, (counts.get(f) ?? 0) + 1);
		}

		const sorted = [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, topN);

		if (sorted.length > 0) {
			const hotFiles = sorted
				.slice(0, 5)
				.map(([f, c]) => `${f} (${c} changes)`)
				.join(", ");
			rules.push({
				text: `High-churn files (review carefully): ${hotFiles}`,
				confidence: 0.6,
				source: "git log (last 500 commits)",
			});
		}
	} catch {
		// Not a git repo or git not available
	}

	return rules;
}

/**
 * Extract CI workflow names and required checks from .github/workflows/*.yml.
 */
export function analyzeCiWorkflows(repoRoot: string): ConstitutionRule[] {
	const rules: ConstitutionRule[] = [];
	const workflowDir = join(repoRoot, ".github", "workflows");

	if (!existsSync(workflowDir)) return rules;

	try {
		const files = readdirSync(workflowDir).filter(
			(f) => f.endsWith(".yml") || f.endsWith(".yaml"),
		);

		const workflowNames: string[] = [];
		for (const file of files) {
			try {
				const content = readFileSync(join(workflowDir, file), "utf-8");
				// Extract workflow name from "name: ..." line
				const nameMatch = content.match(/^name:\s*(.+)$/m);
				if (nameMatch?.[1]) {
					workflowNames.push(nameMatch[1].trim().replace(/['"]/g, ""));
				}
			} catch {
				// Skip unreadable files
			}
		}

		if (workflowNames.length > 0) {
			rules.push({
				text: `CI workflows: ${workflowNames.join(", ")}. All must pass before merge.`,
				confidence: 1.0,
				source: `.github/workflows/ (${files.length} files)`,
			});
		}
	} catch {
		// Directory not readable
	}

	return rules;
}

/**
 * Extract code ownership patterns from CODEOWNERS.
 */
export function analyzeCodeowners(repoRoot: string): ConstitutionRule[] {
	const rules: ConstitutionRule[] = [];

	for (const path of [
		join(repoRoot, "CODEOWNERS"),
		join(repoRoot, ".github", "CODEOWNERS"),
		join(repoRoot, "docs", "CODEOWNERS"),
	]) {
		if (!existsSync(path)) continue;

		try {
			const content = readFileSync(path, "utf-8");
			const entries = content
				.split("\n")
				.filter((l) => l.trim() && !l.startsWith("#"));

			if (entries.length > 0) {
				rules.push({
					text: `CODEOWNERS enforced (${entries.length} rules). Changes to owned paths require owner review.`,
					confidence: 1.0,
					source: path.replace(repoRoot, "").replace(/^\//, ""),
				});
			}
		} catch {
			// Skip unreadable
		}

		break; // Only read the first found CODEOWNERS
	}

	return rules;
}

/**
 * Run all git + CI analyzers and return combined rules.
 * Designed to run fast (<5s on repos up to 10k commits).
 */
export async function analyzeGitAndCi(
	repoRoot: string,
): Promise<ConstitutionRule[]> {
	const [commitRules, hotPaths, ciRules, codeownerRules] = await Promise.all([
		analyzeCommitConventions(repoRoot),
		analyzeHotPaths(repoRoot),
		Promise.resolve(analyzeCiWorkflows(repoRoot)),
		Promise.resolve(analyzeCodeowners(repoRoot)),
	]);

	return [...commitRules, ...hotPaths, ...ciRules, ...codeownerRules];
}
