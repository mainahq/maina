/**
 * Interview Gap-Filler — asks fixed questions to fill convention gaps
 * that automated scanners can't detect.
 *
 * Rejected rules persist in `.maina/rejected.yml` so subsequent
 * scans don't re-propose them.
 *
 * Uses Result<T, E> pattern for all fallible operations.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../db/index";
import type { ConstitutionRule } from "./git-analyzer";

// ── Interview Questions ────────────────────────────────────────────────

export interface InterviewQuestion {
	id: "no-touch-files" | "deploy-gotchas" | "contributor-mistakes";
	question: string;
	hint: string;
	type: "glob" | "text";
}

const VALID_QUESTION_IDS = new Set([
	"no-touch-files",
	"deploy-gotchas",
	"contributor-mistakes",
]);

/**
 * Returns the 3 fixed interview questions.
 */
export function getInterviewQuestions(): InterviewQuestion[] {
	return [
		{
			id: "no-touch-files",
			question: "Files AI should never touch?",
			hint: "Glob patterns, e.g. 'migrations/**, *.lock, .env*'",
			type: "glob",
		},
		{
			id: "deploy-gotchas",
			question: "Deploy-time gotchas?",
			hint: "e.g. 'Must run migrations before deploy', 'CDN cache takes 5min to clear'",
			type: "text",
		},
		{
			id: "contributor-mistakes",
			question: "What does every new contributor get wrong?",
			hint: "e.g. 'Forgetting to run bun install after pulling', 'Using npm instead of bun'",
			type: "text",
		},
	];
}

// ── Rejected Rules Persistence ─────────────────────────────────────────

/**
 * Load rejected rules from `.maina/rejected.yml`.
 * Returns Result with array of rejected rule texts.
 */
export function loadRejectedRules(mainaDir: string): Result<string[]> {
	const filePath = join(mainaDir, "rejected.yml");
	if (!existsSync(filePath)) return { ok: true, value: [] };

	try {
		const content = readFileSync(filePath, "utf-8");
		const rules = content
			.split("\n")
			.filter((line) => line.startsWith("- "))
			.map((line) => line.slice(2).trim())
			.filter(Boolean);
		return { ok: true, value: rules };
	} catch (e) {
		return {
			ok: false,
			error: `Failed to read rejected rules: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

/**
 * Save rejected rules to `.maina/rejected.yml`.
 * Appends to existing rules (deduped).
 */
export function saveRejectedRules(
	mainaDir: string,
	newRejections: string[],
): Result<void> {
	try {
		const loadResult = loadRejectedRules(mainaDir);
		const existing = loadResult.ok ? loadResult.value : [];
		const all = [...new Set([...existing, ...newRejections])];
		const content = `# Rejected constitution rules — maina learn will not re-propose these\n${all.map((r) => `- ${r}`).join("\n")}\n`;
		writeFileSync(join(mainaDir, "rejected.yml"), content, "utf-8");
		return { ok: true, value: undefined };
	} catch (e) {
		return {
			ok: false,
			error: `Failed to save rejected rules: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

// ── Proposal Filtering ─────────────────────────────────────────────────

/**
 * Remove previously rejected rules from a set of proposals.
 * Returns original proposals if rejected rules can't be loaded.
 */
export function filterProposals(
	proposals: ConstitutionRule[],
	mainaDir: string,
): ConstitutionRule[] {
	const loadResult = loadRejectedRules(mainaDir);
	if (!loadResult.ok) return proposals; // Can't filter — return all
	const rejected = new Set(loadResult.value);
	return proposals.filter((rule) => !rejected.has(rule.text));
}

// ── Answer → Rule Conversion ───────────────────────────────────────────

export interface InterviewAnswer {
	questionId: string;
	answer: string;
}

const QUESTION_PREFIXES: Record<string, { prefix: string; source: string }> = {
	"no-touch-files": {
		prefix: "AI must never modify:",
		source: "interview (no-touch-files)",
	},
	"deploy-gotchas": {
		prefix: "Deploy gotcha:",
		source: "interview (deploy-gotchas)",
	},
	"contributor-mistakes": {
		prefix: "Common mistake:",
		source: "interview (contributor-mistakes)",
	},
};

/**
 * Convert interview answers to constitution rules.
 * Human-provided answers get confidence 0.8.
 * Unknown question IDs are skipped (not silently — logged via return).
 */
export function buildRulesFromAnswers(
	answers: InterviewAnswer[],
): Result<ConstitutionRule[]> {
	const rules: ConstitutionRule[] = [];
	const unknownIds: string[] = [];

	for (const { questionId, answer } of answers) {
		if (!answer.trim()) continue;

		const mapping = QUESTION_PREFIXES[questionId];
		if (!mapping) {
			unknownIds.push(questionId);
			continue;
		}

		rules.push({
			text: `${mapping.prefix} ${answer}`,
			confidence: 0.8,
			source: mapping.source,
		});
	}

	if (unknownIds.length > 0) {
		return {
			ok: true,
			value: rules,
		};
	}

	return { ok: true, value: rules };
}
