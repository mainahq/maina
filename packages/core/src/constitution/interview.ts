/**
 * Interview Gap-Filler — asks fixed questions to fill convention gaps
 * that automated scanners can't detect.
 *
 * Rejected rules persist in `.maina/rejected.yml` so subsequent
 * scans don't re-propose them.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConstitutionRule } from "./git-analyzer";

// ── Interview Questions ────────────────────────────────────────────────

export interface InterviewQuestion {
	id: string;
	question: string;
	hint: string;
	type: "glob" | "text";
}

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
 * Returns an array of rejected rule texts.
 */
export function loadRejectedRules(mainaDir: string): string[] {
	const filePath = join(mainaDir, "rejected.yml");
	if (!existsSync(filePath)) return [];

	try {
		const content = readFileSync(filePath, "utf-8");
		return content
			.split("\n")
			.filter((line) => line.startsWith("- "))
			.map((line) => line.slice(2).trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * Save rejected rules to `.maina/rejected.yml`.
 * Appends to existing rules (deduped).
 */
export function saveRejectedRules(
	mainaDir: string,
	newRejections: string[],
): void {
	const existing = loadRejectedRules(mainaDir);
	const all = [...new Set([...existing, ...newRejections])];
	const content = `# Rejected constitution rules — maina learn will not re-propose these\n${all.map((r) => `- ${r}`).join("\n")}\n`;
	writeFileSync(join(mainaDir, "rejected.yml"), content, "utf-8");
}

// ── Proposal Filtering ─────────────────────────────────────────────────

/**
 * Remove previously rejected rules from a set of proposals.
 */
export function filterProposals(
	proposals: ConstitutionRule[],
	mainaDir: string,
): ConstitutionRule[] {
	const rejected = new Set(loadRejectedRules(mainaDir));
	return proposals.filter((rule) => !rejected.has(rule.text));
}

// ── Answer → Rule Conversion ───────────────────────────────────────────

export interface InterviewAnswer {
	questionId: string;
	answer: string;
}

/**
 * Convert interview answers to constitution rules.
 * Human-provided answers get confidence 0.8.
 */
export function buildRulesFromAnswers(
	answers: InterviewAnswer[],
): ConstitutionRule[] {
	const rules: ConstitutionRule[] = [];

	for (const { questionId, answer } of answers) {
		if (!answer.trim()) continue;

		switch (questionId) {
			case "no-touch-files":
				rules.push({
					text: `AI must never modify: ${answer}`,
					confidence: 0.8,
					source: "interview (no-touch-files)",
				});
				break;
			case "deploy-gotchas":
				rules.push({
					text: `Deploy gotcha: ${answer}`,
					confidence: 0.8,
					source: "interview (deploy-gotchas)",
				});
				break;
			case "contributor-mistakes":
				rules.push({
					text: `Common mistake: ${answer}`,
					confidence: 0.8,
					source: "interview (contributor-mistakes)",
				});
				break;
		}
	}

	return rules;
}
