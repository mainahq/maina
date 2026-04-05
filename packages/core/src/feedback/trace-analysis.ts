/**
 * Post-workflow RL Trace Analysis — analyzes completed workflow traces
 * to propose prompt improvements.
 *
 * After a full workflow completes (brainstorm → ... → pr):
 * 1. Collects the full trace from workflow context
 * 2. Analyzes: which steps had issues? How did findings trend?
 * 3. Proposes prompt improvements based on patterns
 * 4. Feeds into maina learn automatically
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────

export interface TraceStep {
	command: string;
	timestamp: string;
	summary: string;
	findingsCount?: number;
}

export interface PromptImprovement {
	promptFile: string;
	reason: string;
	suggestion: string;
	confidence: number;
}

export interface TraceResult {
	steps: TraceStep[];
	improvements: PromptImprovement[];
	summary: string;
}

// ─── Trace Parsing ───────────────────────────────────────────────────────

/**
 * Parse the workflow context file into structured trace steps.
 */
function parseWorkflowContext(content: string): TraceStep[] {
	const steps: TraceStep[] = [];
	const stepPattern =
		/^## (\w+) \((\d{4}-\d{2}-\d{2}T[\d:.]+Z)\)\s*\n([\s\S]*?)(?=\n## |\n*$)/gm;

	for (const match of content.matchAll(stepPattern)) {
		const command = match[1] ?? "";
		const timestamp = match[2] ?? "";
		const summary = (match[3] ?? "").trim();

		// Extract findings count if present
		const findingsMatch = summary.match(/(\d+)\s+findings?/);
		const findingsCount = findingsMatch
			? Number.parseInt(findingsMatch[1] ?? "0", 10)
			: undefined;

		steps.push({ command, timestamp, summary, findingsCount });
	}

	return steps;
}

// ─── Analysis ────────────────────────────────────────────────────────────

/**
 * Analyze trace steps for patterns that suggest prompt improvements.
 */
function analyzePatterns(steps: TraceStep[]): PromptImprovement[] {
	const improvements: PromptImprovement[] = [];

	// Pattern 1: Multiple commits with findings before a clean one
	const commitSteps = steps.filter(
		(s) => s.command === "commit" && s.findingsCount !== undefined,
	);
	const dirtyCommits = commitSteps.filter(
		(s) => s.findingsCount !== undefined && s.findingsCount > 0,
	);

	if (dirtyCommits.length >= 2) {
		improvements.push({
			promptFile: "prompts/review.md",
			reason: `${dirtyCommits.length} commits had verification findings before clean pass — review prompt may need to catch these patterns earlier.`,
			suggestion:
				"Add examples of common finding patterns to the review prompt so AI catches them in the first pass.",
			confidence: 0.6,
		});
	}

	// Pattern 2: Workflow has no review step
	const hasReview = steps.some((s) => s.command === "review");
	if (steps.length >= 3 && !hasReview) {
		improvements.push({
			promptFile: "prompts/commit.md",
			reason:
				"Workflow completed without a review step — commit prompt could remind about review.",
			suggestion:
				"Add a reminder to run maina review before committing when changes are substantial.",
			confidence: 0.4,
		});
	}

	return improvements;
}

/**
 * Generate a human-readable summary of the trace analysis.
 */
function generateSummary(
	steps: TraceStep[],
	improvements: PromptImprovement[],
): string {
	if (steps.length === 0) return "No workflow trace found.";

	const commands = steps.map((s) => s.command).join(" → ");
	const totalFindings = steps
		.filter((s) => s.findingsCount !== undefined)
		.reduce((sum, s) => sum + (s.findingsCount ?? 0), 0);

	let summary = `Workflow: ${commands} (${steps.length} steps, ${totalFindings} total findings)`;

	if (improvements.length > 0) {
		summary += `\n${improvements.length} improvement(s) suggested.`;
	}

	return summary;
}

// ─── Main ────────────────────────────────────────────────────────────────

/**
 * Analyze the current workflow trace and generate improvement proposals.
 *
 * This runs after maina pr completes. It reads the workflow context,
 * correlates with feedback data, and proposes prompt improvements
 * that are automatically fed into maina learn.
 */
export async function analyzeWorkflowTrace(
	mainaDir: string,
): Promise<TraceResult> {
	const workflowFile = join(mainaDir, "workflow", "current.md");

	if (!existsSync(workflowFile)) {
		return { steps: [], improvements: [], summary: "No workflow trace found." };
	}

	const content = readFileSync(workflowFile, "utf-8");
	const steps = parseWorkflowContext(content);
	const improvements = analyzePatterns(steps);
	const summary = generateSummary(steps, improvements);

	return { steps, improvements, summary };
}
