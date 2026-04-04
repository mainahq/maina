/**
 * Workflow Context — rolling summary forwarded between maina lifecycle steps.
 *
 * Each maina command appends a step summary to `.maina/workflow/current.md`.
 * The context engine includes this in the working layer for AI calls.
 * `maina plan` resets it for new features.
 */

import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// ─── Paths ────────────────────────────────────────────────────────────────

function workflowFilePath(mainaDir: string): string {
	return join(mainaDir, "workflow", "current.md");
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Reset the workflow context for a new feature.
 * Overwrites any existing workflow context.
 */
export function resetWorkflowContext(
	mainaDir: string,
	featureName: string,
): void {
	const filePath = workflowFilePath(mainaDir);
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(filePath, `# Workflow: ${featureName}\n`);
}

/**
 * Append a workflow step summary.
 * Each step includes the step name, ISO timestamp, and a concise summary.
 */
export function appendWorkflowStep(
	mainaDir: string,
	step: string,
	summary: string,
): void {
	const filePath = workflowFilePath(mainaDir);
	if (!existsSync(filePath)) {
		// If no workflow file exists, create a minimal one
		const dir = dirname(filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(filePath, "# Workflow\n");
	}

	const timestamp = new Date().toISOString();
	const entry = `\n## ${step} (${timestamp})\n${summary}\n`;
	appendFileSync(filePath, entry);
}

/**
 * Load the current workflow context.
 * Returns the full markdown content, or null if no workflow is active.
 */
export function loadWorkflowContext(mainaDir: string): string | null {
	const filePath = workflowFilePath(mainaDir);
	if (!existsSync(filePath)) {
		return null;
	}
	try {
		const content = readFileSync(filePath, "utf-8");
		return content.trim() || null;
	} catch {
		return null;
	}
}
