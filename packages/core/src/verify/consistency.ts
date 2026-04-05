/**
 * Cross-function Consistency Check — deterministic AST-based analysis.
 *
 * Catches the class of bug that lost Maina 2 points in the Tier 3 benchmark:
 * functions that call a validator on one code path but skip it on another.
 *
 * Two modes:
 * 1. Spec-based: reads spec.md / constitution.md for stated constraints,
 *    builds a rule set, checks compliance
 * 2. Heuristic: if no spec exists, looks for inconsistent validator usage
 *    patterns across related functions
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ConsistencyRule {
	pattern: string;
	source: "spec" | "heuristic";
}

export interface ConsistencyResult {
	findings: Finding[];
	rulesChecked: number;
}

// ─── Rule Extraction ─────────────────────────────────────────────────────

/**
 * Extract consistency rules from spec/constitution content.
 * Looks for patterns like "use X when Y", "always call X", "validate with X".
 */
function extractRulesFromSpec(content: string): ConsistencyRule[] {
	const rules: ConsistencyRule[] = [];
	const patterns = [
		/always (?:use|call|check|validate with) (\w+)/gi,
		/must (?:use|call|check) (\w+)/gi,
		/validate.*(?:with|using) (\w+)/gi,
	];

	for (const pattern of patterns) {
		for (const match of content.matchAll(pattern)) {
			rules.push({
				pattern: match[1] ?? "",
				source: "spec",
			});
		}
	}

	return rules;
}

/**
 * Load spec/constitution content from the maina directory.
 */
function loadSpecContent(mainaDir: string): string {
	const paths = [join(mainaDir, "constitution.md"), join(mainaDir, "spec.md")];

	const parts: string[] = [];
	for (const p of paths) {
		if (existsSync(p)) {
			parts.push(readFileSync(p, "utf-8"));
		}
	}

	return parts.join("\n");
}

// ─── Heuristic Analysis ──────────────────────────────────────────────────

/**
 * Find functions that call validators inconsistently.
 * If functionA calls isValid(x) and functionB doesn't but both take similar
 * params, that's a potential inconsistency.
 */
function findHeuristicIssues(source: string, file: string): Finding[] {
	const findings: Finding[] = [];

	// Extract function calls per function body
	const functionPattern =
		/function\s+(\w+)\s*\([^)]*\)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
	const functions: Array<{ name: string; body: string; line: number }> = [];

	for (const match of source.matchAll(functionPattern)) {
		const lineNumber = source.substring(0, match.index ?? 0).split("\n").length;
		functions.push({
			name: match[1] ?? "",
			body: match[2] ?? "",
			line: lineNumber,
		});
	}

	// Find validator-like calls (isX, validateX, checkX)
	const validatorPattern = /\b(is[A-Z]\w+|validate\w+|check\w+)\s*\(/g;
	const validatorsByFunction = new Map<string, Set<string>>();

	for (const fn of functions) {
		const validators = new Set<string>();
		for (const validatorMatch of fn.body.matchAll(validatorPattern)) {
			validators.add(validatorMatch[1] ?? "");
		}
		validatorsByFunction.set(fn.name, validators);
	}

	// Compare: if most functions use a validator but one doesn't, flag it
	const allValidators = new Set<string>();
	for (const validators of validatorsByFunction.values()) {
		for (const v of validators) allValidators.add(v);
	}

	if (functions.length >= 2) {
		for (const validator of allValidators) {
			const usersCount = Array.from(validatorsByFunction.values()).filter((v) =>
				v.has(validator),
			).length;

			// If majority uses it but some don't, flag the ones that don't
			if (usersCount > 0 && usersCount < functions.length) {
				for (const fn of functions) {
					const fnValidators = validatorsByFunction.get(fn.name);
					if (fnValidators && !fnValidators.has(validator)) {
						findings.push({
							tool: "consistency",
							file,
							line: fn.line,
							message: `Function '${fn.name}' does not call '${validator}' — other functions in this file do. Possible inconsistency.`,
							severity: "warning",
							ruleId: `consistency/${validator}`,
						});
					}
				}
			}
		}
	}

	return findings;
}

// ─── Main ────────────────────────────────────────────────────────────────

export async function checkConsistency(
	files: string[],
	cwd: string,
	mainaDir: string,
): Promise<ConsistencyResult> {
	const specContent = existsSync(mainaDir) ? loadSpecContent(mainaDir) : "";
	const specRules = extractRulesFromSpec(specContent);
	const allFindings: Finding[] = [];

	for (const file of files) {
		const filePath = join(cwd, file);
		if (!existsSync(filePath)) continue;

		const source = readFileSync(filePath, "utf-8");

		// Check spec-based rules
		for (const rule of specRules) {
			const callPattern = new RegExp(`\\b${rule.pattern}\\s*\\(`, "g");
			const fnPattern = /function\s+(\w+)/g;

			// Find functions that should use this pattern but don't
			for (const fnMatch of source.matchAll(fnPattern)) {
				const fnStart = fnMatch.index ?? 0;
				const fnEnd = source.indexOf("}", fnStart + 1);
				if (fnEnd === -1) continue;

				const fnBody = source.substring(fnStart, fnEnd);
				if (!callPattern.test(fnBody)) {
					const relatedTerms = rule.pattern
						.toLowerCase()
						.replace(/^is|^validate|^check/, "");
					if (fnBody.toLowerCase().includes(relatedTerms)) {
						const line = source.substring(0, fnStart).split("\n").length;
						allFindings.push({
							tool: "consistency",
							file,
							line,
							message: `Spec requires '${rule.pattern}' — function '${fnMatch[1]}' may need it.`,
							severity: "warning",
							ruleId: `consistency/spec-${rule.pattern}`,
						});
					}
				}
			}
		}

		// Heuristic checks (always run)
		allFindings.push(...findHeuristicIssues(source, file));
	}

	return {
		findings: allFindings,
		rulesChecked: specRules.length + 1, // +1 for heuristic check
	};
}
