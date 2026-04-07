import { describe, expect, it } from "bun:test";
import {
	DEFAULT_SCHEMA,
	getArticleMaxLength,
	getLinkSyntax,
	validateArticleStructure,
} from "../schema";
import type { ArticleType } from "../types";

describe("Wiki Schema", () => {
	describe("DEFAULT_SCHEMA", () => {
		it("should define rules for all 6 article types", () => {
			const types: ArticleType[] = [
				"module",
				"entity",
				"feature",
				"decision",
				"architecture",
				"raw",
			];
			for (const type of types) {
				expect(DEFAULT_SCHEMA.articleRules[type]).toBeDefined();
			}
		});

		it("should have a schema version", () => {
			expect(DEFAULT_SCHEMA.version).toBeTruthy();
		});
	});

	describe("getArticleMaxLength", () => {
		it("should return max length for each article type", () => {
			expect(getArticleMaxLength("module")).toBeGreaterThan(0);
			expect(getArticleMaxLength("entity")).toBeGreaterThan(0);
			expect(getArticleMaxLength("feature")).toBeGreaterThan(0);
			expect(getArticleMaxLength("decision")).toBeGreaterThan(0);
			expect(getArticleMaxLength("architecture")).toBeGreaterThan(0);
			expect(getArticleMaxLength("raw")).toBeGreaterThan(0);
		});

		it("should have entities shorter than modules", () => {
			expect(getArticleMaxLength("entity")).toBeLessThanOrEqual(
				getArticleMaxLength("module"),
			);
		});
	});

	describe("getLinkSyntax", () => {
		it("should return wikilink format for entities", () => {
			expect(getLinkSyntax("entity", "runPipeline")).toBe(
				"[[entity:runPipeline]]",
			);
		});

		it("should return wikilink format for features", () => {
			expect(getLinkSyntax("feature", "001-auth")).toBe("[[feature:001-auth]]");
		});

		it("should return wikilink format for decisions", () => {
			expect(getLinkSyntax("decision", "002-jwt")).toBe("[[decision:002-jwt]]");
		});

		it("should return wikilink format for modules", () => {
			expect(getLinkSyntax("module", "auth")).toBe("[[module:auth]]");
		});

		it("should return wikilink format for architecture", () => {
			expect(getLinkSyntax("architecture", "verify-pipeline")).toBe(
				"[[architecture:verify-pipeline]]",
			);
		});
	});

	describe("validateArticleStructure", () => {
		it("should pass for a valid module article", () => {
			const content = [
				"# Auth Module",
				"",
				"## Overview",
				"Handles authentication.",
				"",
				"## Entities",
				"- jwt.ts",
				"",
				"## Dependencies",
				"- crypto module",
			].join("\n");

			const result = validateArticleStructure("module", content);
			expect(result.valid).toBe(true);
			expect(result.issues).toHaveLength(0);
		});

		it("should fail for article missing title", () => {
			const content = "No title here, just text.";
			const result = validateArticleStructure("entity", content);
			expect(result.valid).toBe(false);
			expect(result.issues.length).toBeGreaterThan(0);
		});

		it("should fail for article exceeding max length", () => {
			const content = `# Long Article\n${"x".repeat(50_000)}`;
			const result = validateArticleStructure("entity", content);
			expect(result.valid).toBe(false);
			expect(result.issues.some((i) => i.includes("length"))).toBe(true);
		});

		it("should pass for empty content with just a title", () => {
			const content = "# Minimal Entity";
			const result = validateArticleStructure("entity", content);
			expect(result.valid).toBe(true);
		});
	});
});
