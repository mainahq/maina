/**
 * Workflow Trace Extractor — parses .maina/workflow/current.md into
 * structured ExtractedWorkflowTrace records.
 *
 * Workflow traces follow the rolling markdown format:
 *   # Workflow: feature-name
 *   ## step-name (ISO-timestamp)
 *   Summary text.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../../db/index";
import type { ExtractedWorkflowTrace, WorkflowStep } from "../types";

// ─── Parsing ─────────────────────────────────────────────────────────────

/**
 * Extract feature name from "# Workflow: feature-name" header.
 */
function extractFeatureId(firstLine: string): string {
	const match = firstLine.match(/^#\s+Workflow:\s*(.+)/);
	return match?.[1]?.trim() ?? "";
}

/**
 * Parse workflow steps from markdown content.
 * Each step is an H2 heading with optional ISO timestamp in parens.
 */
function parseSteps(content: string): WorkflowStep[] {
	const steps: WorkflowStep[] = [];
	const lines = content.split("\n");
	let currentCommand = "";
	let currentTimestamp = "";
	const summaryLines: string[] = [];

	function flushStep(): void {
		if (currentCommand) {
			steps.push({
				command: currentCommand,
				timestamp: currentTimestamp,
				summary: summaryLines.join("\n").trim(),
			});
		}
		summaryLines.length = 0;
	}

	for (const line of lines) {
		// Match step headers like "## brainstorm (2026-04-07T10:00:00.000Z)"
		const stepMatch = line.match(
			/^##\s+(\S+)(?:\s+\((\d{4}-\d{2}-\d{2}T[^)]+)\))?/,
		);
		if (stepMatch) {
			flushStep();
			currentCommand = stepMatch[1] ?? "";
			currentTimestamp = stepMatch[2] ?? "";
			continue;
		}

		// Skip H1 header
		if (line.startsWith("# ")) {
			continue;
		}

		if (currentCommand) {
			summaryLines.push(line);
		}
	}
	flushStep();

	return steps;
}

// ─── Public API ──────────────────────────────────────────────────────────

export function extractWorkflowTrace(
	mainaDir: string,
): Result<ExtractedWorkflowTrace> {
	const workflowPath = join(mainaDir, "workflow", "current.md");

	if (!existsSync(workflowPath)) {
		return {
			ok: false,
			error: `Workflow file does not exist: ${workflowPath}`,
		};
	}

	let content: string;
	try {
		content = readFileSync(workflowPath, "utf-8");
	} catch {
		return {
			ok: false,
			error: `Failed to read workflow file: ${workflowPath}`,
		};
	}

	const firstLine = content.split("\n")[0] ?? "";
	const featureId = extractFeatureId(firstLine);
	const steps = parseSteps(content);

	return {
		ok: true,
		value: {
			featureId,
			steps,
			wikiRefsRead: [],
			wikiRefsWritten: [],
			rlSignals: [],
		},
	};
}
