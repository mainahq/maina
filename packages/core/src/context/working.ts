import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getCurrentBranch } from "../git/index";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VerificationResult {
	passed: boolean;
	checks: { name: string; passed: boolean; output?: string }[];
	timestamp: string;
}

export interface WorkingContext {
	branch: string;
	planContent: string | null;
	touchedFiles: string[];
	lastVerification: VerificationResult | null;
	updatedAt: string;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function contextFilePath(mainaDir: string): string {
	return join(mainaDir, "context", "working.json");
}

function freshContext(branch: string): WorkingContext {
	return {
		branch,
		planContent: null,
		touchedFiles: [],
		lastVerification: null,
		updatedAt: new Date().toISOString(),
	};
}

async function readPlanContent(repoRoot: string): Promise<string | null> {
	try {
		const planPath = join(repoRoot, "PLAN.md");
		const file = Bun.file(planPath);
		if (await file.exists()) {
			return await file.text();
		}
		return null;
	} catch {
		return null;
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load the working context from disk.
 *
 * - If no file exists, returns a fresh context for the current branch.
 * - If the saved branch differs from the current git branch, resets to a fresh
 *   context (branch switch detected).
 * - Always refreshes planContent from PLAN.md on load.
 */
export async function loadWorkingContext(
	mainaDir: string,
	repoRoot: string,
): Promise<WorkingContext> {
	const currentBranch = await getCurrentBranch(repoRoot);

	const planContent = await readPlanContent(repoRoot);

	try {
		const filePath = contextFilePath(mainaDir);
		const file = Bun.file(filePath);
		if (!(await file.exists())) {
			return { ...freshContext(currentBranch), planContent };
		}

		const raw = await file.text();
		const saved: WorkingContext = JSON.parse(raw);

		// Branch switch — discard stale session state
		if (saved.branch !== currentBranch) {
			return { ...freshContext(currentBranch), planContent };
		}

		// Refresh plan content from disk
		return { ...saved, planContent };
	} catch {
		return { ...freshContext(currentBranch), planContent };
	}
}

/**
 * Persist the working context to `.maina/context/working.json`.
 * Creates parent directories as needed. Never throws.
 */
export async function saveWorkingContext(
	mainaDir: string,
	context: WorkingContext,
): Promise<void> {
	try {
		const filePath = contextFilePath(mainaDir);
		mkdirSync(dirname(filePath), { recursive: true });
		// planContent is runtime-only — no need to persist it (we re-read on load)
		// but we DO persist it so round-trip tests work without git side-effects
		const payload = { ...context, updatedAt: new Date().toISOString() };
		await Bun.write(filePath, JSON.stringify(payload, null, 2));
	} catch {
		// Intentionally swallowed — never throw
	}
}

/**
 * Add a file path to the touchedFiles list (deduplicating) and save.
 */
export async function trackFile(
	mainaDir: string,
	repoRoot: string,
	filePath: string,
): Promise<WorkingContext> {
	const ctx = await loadWorkingContext(mainaDir, repoRoot);
	if (!ctx.touchedFiles.includes(filePath)) {
		ctx.touchedFiles = [...ctx.touchedFiles, filePath];
	}
	ctx.updatedAt = new Date().toISOString();
	await saveWorkingContext(mainaDir, ctx);
	return ctx;
}

/**
 * Record the latest verification run result and save.
 */
export async function setVerificationResult(
	mainaDir: string,
	repoRoot: string,
	result: VerificationResult,
): Promise<WorkingContext> {
	const ctx = await loadWorkingContext(mainaDir, repoRoot);
	ctx.lastVerification = result;
	ctx.updatedAt = new Date().toISOString();
	await saveWorkingContext(mainaDir, ctx);
	return ctx;
}

/**
 * Return a brand-new empty WorkingContext without touching disk.
 * The branch field is set to an empty string — caller should fill it in.
 */
export function resetWorkingContext(mainaDir: string): WorkingContext {
	// mainaDir accepted for API symmetry / future use
	void mainaDir;
	return freshContext("");
}

/**
 * Format the working context as a human/LLM-readable string.
 */
export function assembleWorkingText(context: WorkingContext): string {
	const lines: string[] = [];

	lines.push(`Current branch: ${context.branch}`);
	lines.push(`Touched files: ${context.touchedFiles.length}`);

	if (context.touchedFiles.length > 0) {
		lines.push("Files modified this session:");
		for (const f of context.touchedFiles) {
			lines.push(`  - ${f}`);
		}
	}

	if (context.lastVerification !== null) {
		const v = context.lastVerification;
		const status = v.passed ? "passed" : "failed";
		lines.push(`Last verification: ${status} (${v.timestamp})`);
		for (const check of v.checks) {
			const checkStatus = check.passed ? "pass" : "fail";
			const detail = check.output ? ` — ${check.output}` : "";
			lines.push(`  [${checkStatus}] ${check.name}${detail}`);
		}
	}

	if (context.planContent !== null) {
		lines.push("");
		lines.push("PLAN.md:");
		lines.push(context.planContent);
	}

	lines.push(`Updated at: ${context.updatedAt}`);

	return lines.join("\n");
}
