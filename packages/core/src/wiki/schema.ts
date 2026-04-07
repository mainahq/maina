/**
 * Wiki Schema — defines article structure, max lengths, and linking conventions.
 *
 * The schema co-evolves with compilation prompts. It defines what valid
 * wiki articles look like for each article type.
 */

import type { ArticleType } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────

export interface ArticleRule {
	maxLength: number;
	requiredSections: string[];
	linkPrefix: string;
}

export interface WikiSchema {
	version: string;
	articleRules: Record<ArticleType, ArticleRule>;
}

export interface ValidationResult {
	valid: boolean;
	issues: string[];
}

// ─── Default Schema ──────────────────────────────────────────────────────

export const DEFAULT_SCHEMA: WikiSchema = {
	version: "1.0.0",
	articleRules: {
		module: {
			maxLength: 10_000,
			requiredSections: [],
			linkPrefix: "module",
		},
		entity: {
			maxLength: 5_000,
			requiredSections: [],
			linkPrefix: "entity",
		},
		feature: {
			maxLength: 8_000,
			requiredSections: [],
			linkPrefix: "feature",
		},
		decision: {
			maxLength: 8_000,
			requiredSections: [],
			linkPrefix: "decision",
		},
		architecture: {
			maxLength: 10_000,
			requiredSections: [],
			linkPrefix: "architecture",
		},
		raw: {
			maxLength: 10_000,
			requiredSections: [],
			linkPrefix: "raw",
		},
	},
};

// ─── Helpers ─────────────────────────────────────────────────────────────

export function getArticleMaxLength(type: ArticleType): number {
	return DEFAULT_SCHEMA.articleRules[type].maxLength;
}

export function getLinkSyntax(type: ArticleType, id: string): string {
	const prefix = DEFAULT_SCHEMA.articleRules[type].linkPrefix;
	return `[[${prefix}:${id}]]`;
}

/**
 * Validate an article's structure against the schema rules for its type.
 * Returns validation result with any issues found.
 */
export function validateArticleStructure(
	type: ArticleType,
	content: string,
): ValidationResult {
	const issues: string[] = [];
	const rule = DEFAULT_SCHEMA.articleRules[type];

	// Check for title (must start with # heading)
	if (!content.trimStart().startsWith("#")) {
		issues.push("Article must start with a markdown heading (# Title)");
	}

	// Check max length
	if (content.length > rule.maxLength) {
		issues.push(
			`Article exceeds max length: ${content.length} > ${rule.maxLength}`,
		);
	}

	// Check required sections
	for (const section of rule.requiredSections) {
		if (!content.includes(`## ${section}`)) {
			issues.push(`Missing required section: ## ${section}`);
		}
	}

	return {
		valid: issues.length === 0,
		issues,
	};
}
