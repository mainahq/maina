import { describe, expect, it } from "bun:test";
import { generateIndex } from "../indexer";
import type { WikiArticle } from "../types";

// ─── Helpers ────────────────────────────────────────────────────────────

function makeArticle(
	overrides: Partial<WikiArticle> & {
		path: string;
		type: WikiArticle["type"];
		title: string;
	},
): WikiArticle {
	return {
		content: "",
		contentHash: "abc123",
		sourceHashes: [],
		backlinks: [],
		forwardLinks: [],
		pageRank: 0,
		lastCompiled: new Date().toISOString(),
		referenceCount: 0,
		ebbinghausScore: 1.0,
		...overrides,
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Wiki Indexer", () => {
	describe("generateIndex", () => {
		it("should generate a markdown index with title", () => {
			const index = generateIndex([]);
			expect(index).toContain("# Wiki Index");
		});

		it("should show article count in the description", () => {
			const articles = [
				makeArticle({
					path: "wiki/modules/auth.md",
					type: "module",
					title: "Auth Module",
				}),
				makeArticle({
					path: "wiki/entities/jwt.md",
					type: "entity",
					title: "JWT",
				}),
			];

			const index = generateIndex(articles);
			expect(index).toContain("2 articles");
		});

		it("should group articles by type", () => {
			const articles = [
				makeArticle({
					path: "wiki/modules/auth.md",
					type: "module",
					title: "Auth Module",
				}),
				makeArticle({
					path: "wiki/entities/jwt.md",
					type: "entity",
					title: "JWT",
				}),
				makeArticle({
					path: "wiki/features/login.md",
					type: "feature",
					title: "Login Feature",
				}),
				makeArticle({
					path: "wiki/decisions/use-jwt.md",
					type: "decision",
					title: "Use JWT",
				}),
			];

			const index = generateIndex(articles);
			expect(index).toContain("## Modules");
			expect(index).toContain("## Entities");
			expect(index).toContain("## Features");
			expect(index).toContain("## Decisions");
		});

		it("should include markdown links to articles", () => {
			const articles = [
				makeArticle({
					path: "wiki/modules/auth.md",
					type: "module",
					title: "Auth Module",
				}),
			];

			const index = generateIndex(articles);
			expect(index).toContain("[Auth Module](wiki/modules/auth.md)");
		});

		it("should sort articles by PageRank within each group", () => {
			const articles = [
				makeArticle({
					path: "wiki/entities/low.md",
					type: "entity",
					title: "Low PR",
					pageRank: 0.1,
				}),
				makeArticle({
					path: "wiki/entities/high.md",
					type: "entity",
					title: "High PR",
					pageRank: 0.9,
				}),
				makeArticle({
					path: "wiki/entities/mid.md",
					type: "entity",
					title: "Mid PR",
					pageRank: 0.5,
				}),
			];

			const index = generateIndex(articles);
			const highIdx = index.indexOf("High PR");
			const midIdx = index.indexOf("Mid PR");
			const lowIdx = index.indexOf("Low PR");

			expect(highIdx).toBeLessThan(midIdx);
			expect(midIdx).toBeLessThan(lowIdx);
		});

		it("should include freshness indicators", () => {
			const now = new Date().toISOString();
			const articles = [
				makeArticle({
					path: "wiki/modules/fresh.md",
					type: "module",
					title: "Fresh Module",
					lastCompiled: now,
				}),
			];

			const index = generateIndex(articles);
			expect(index).toContain("[fresh]");
		});

		it("should show stale indicator for old articles", () => {
			const oldDate = new Date(
				Date.now() - 60 * 24 * 60 * 60 * 1000,
			).toISOString();
			const articles = [
				makeArticle({
					path: "wiki/modules/old.md",
					type: "module",
					title: "Old Module",
					lastCompiled: oldDate,
				}),
			];

			const index = generateIndex(articles);
			expect(index).toContain("[stale]");
		});

		it("should show aging indicator for articles 8-30 days old", () => {
			const agingDate = new Date(
				Date.now() - 15 * 24 * 60 * 60 * 1000,
			).toISOString();
			const articles = [
				makeArticle({
					path: "wiki/modules/aging.md",
					type: "module",
					title: "Aging Module",
					lastCompiled: agingDate,
				}),
			];

			const index = generateIndex(articles);
			expect(index).toContain("[aging]");
		});

		it("should show recent indicator for articles 2-6 days old", () => {
			const recentDate = new Date(
				Date.now() - 3 * 24 * 60 * 60 * 1000,
			).toISOString();
			const articles = [
				makeArticle({
					path: "wiki/modules/recent.md",
					type: "module",
					title: "Recent Module",
					lastCompiled: recentDate,
				}),
			];

			const index = generateIndex(articles);
			expect(index).toContain("[recent]");
		});

		it("should handle empty lastCompiled as stale", () => {
			const articles = [
				makeArticle({
					path: "wiki/modules/nodate.md",
					type: "module",
					title: "No Date",
					lastCompiled: "",
				}),
			];

			const index = generateIndex(articles);
			expect(index).toContain("[stale]");
		});

		it("should not render sections for types with no articles", () => {
			const articles = [
				makeArticle({
					path: "wiki/modules/auth.md",
					type: "module",
					title: "Auth Module",
				}),
			];

			const index = generateIndex(articles);
			expect(index).toContain("## Modules");
			expect(index).not.toContain("## Entities");
			expect(index).not.toContain("## Features");
			expect(index).not.toContain("## Decisions");
		});

		it("should render type sections in defined order", () => {
			const articles = [
				makeArticle({
					path: "wiki/decisions/d.md",
					type: "decision",
					title: "Decision",
				}),
				makeArticle({
					path: "wiki/features/f.md",
					type: "feature",
					title: "Feature",
				}),
				makeArticle({
					path: "wiki/modules/m.md",
					type: "module",
					title: "Module",
				}),
				makeArticle({
					path: "wiki/entities/e.md",
					type: "entity",
					title: "Entity",
				}),
			];

			const index = generateIndex(articles);
			const moduleIdx = index.indexOf("## Modules");
			const entityIdx = index.indexOf("## Entities");
			const featureIdx = index.indexOf("## Features");
			const decisionIdx = index.indexOf("## Decisions");

			// Order: Architecture > Modules > Entities > Features > Decisions
			expect(moduleIdx).toBeLessThan(entityIdx);
			expect(entityIdx).toBeLessThan(featureIdx);
			expect(featureIdx).toBeLessThan(decisionIdx);
		});

		it("should report category count correctly", () => {
			const articles = [
				makeArticle({
					path: "wiki/modules/a.md",
					type: "module",
					title: "A",
				}),
				makeArticle({
					path: "wiki/modules/b.md",
					type: "module",
					title: "B",
				}),
				makeArticle({
					path: "wiki/features/c.md",
					type: "feature",
					title: "C",
				}),
			];

			const index = generateIndex(articles);
			expect(index).toContain("2 categories");
		});
	});
});
