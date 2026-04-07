/**
 * Tests for wiki consult — pre-command wiki consultation.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	consultWikiForBrainstorm,
	consultWikiForDesign,
	consultWikiForPlan,
} from "../consult";

// ── Test Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;
let wikiDir: string;

function createTmpDir(): string {
	const dir = join(
		import.meta.dir,
		`tmp-consult-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function seedWiki(wiki: string): void {
	const subdirs = [
		"modules",
		"entities",
		"features",
		"decisions",
		"architecture",
	];
	for (const subdir of subdirs) {
		mkdirSync(join(wiki, subdir), { recursive: true });
	}

	// Module: verify with 11 entities
	writeFileSync(
		join(wiki, "modules", "verify.md"),
		[
			"# Module: verify",
			"",
			"> Auto-generated module article for `verify`.",
			"",
			"## Entities",
			"",
			"- **runPipeline** (function) — `verify/pipeline.ts:10`",
			"- **syntaxGuard** (function) — `verify/syntax.ts:5`",
			"- **diffFilter** (function) — `verify/diff.ts:1`",
			"- **slopDetector** (function) — `verify/slop.ts:8`",
			"- **reviewCode** (function) — `verify/review.ts:3`",
			"- **PipelineResult** (interface) — `verify/types.ts:1`",
			"- **Finding** (interface) — `verify/types.ts:20`",
			"- **ToolRunner** (interface) — `verify/types.ts:40`",
			"- **SyntaxError** (interface) — `verify/types.ts:60`",
			"- **DiffFilter** (interface) — `verify/types.ts:80`",
			"- **SlopPattern** (interface) — `verify/types.ts:100`",
		].join("\n"),
	);

	// Module: context with 8 entities
	writeFileSync(
		join(wiki, "modules", "context.md"),
		[
			"# Module: context",
			"",
			"> Auto-generated module article for `context`.",
			"",
			"## Entities",
			"",
			"- **assembleContext** (function) — `context/engine.ts:10`",
			"- **parseFile** (function) — `context/treesitter.ts:5`",
			"- **extractEntities** (function) — `context/treesitter.ts:50`",
			"- **ContextResult** (interface) — `context/types.ts:1`",
			"- **TokenBudget** (interface) — `context/budget.ts:1`",
			"- **SemanticLayer** (class) — `context/semantic.ts:10`",
			"- **EpisodicLayer** (class) — `context/episodic.ts:10`",
			"- **WorkingLayer** (class) — `context/working.ts:10`",
		].join("\n"),
	);

	// Decision: accepted — multi-language with Biome
	writeFileSync(
		join(wiki, "decisions", "0002-multi-language-verify-pipeline.md"),
		[
			"# Decision: Multi-language verify pipeline",
			"",
			"> Status: **accepted**",
			"",
			"## Context",
			"",
			"Maina needs multi-language support for the verify pipeline.",
			"",
			"## Decision",
			"",
			"Use Biome for TypeScript linting. Use ruff for Python. Use clippy for Rust.",
			"Introduce LanguageProfile abstraction for each supported language.",
		].join("\n"),
	);

	// Decision: proposed — spec quality
	writeFileSync(
		join(wiki, "decisions", "0001-spec-quality.md"),
		[
			"# Decision: Spec quality system",
			"",
			"> Status: **proposed**",
			"",
			"## Context",
			"",
			"Specifications need quality scoring to prevent bad specs.",
			"",
			"## Decision",
			"",
			"Build a spec scoring system with measurability and testability checks.",
		].join("\n"),
	);

	// Feature: similar to hardening
	writeFileSync(
		join(wiki, "features", "024-v03x-hardening.md"),
		[
			"# Feature: Implementation Plan — v0.3.x Hardening",
			"",
			"## Status",
			"",
			"Verify pipeline improvements, gap fixes, RL loop integration.",
		].join("\n"),
	);

	// Feature: benchmark
	writeFileSync(
		join(wiki, "features", "010-benchmark-harness.md"),
		[
			"# Feature: Benchmark harness",
			"",
			"## Status",
			"",
			"Full lifecycle benchmark comparison framework.",
		].join("\n"),
	);

	// Architecture
	writeFileSync(
		join(wiki, "architecture", "three-engines.md"),
		[
			"# Architecture: Three Engines",
			"",
			"Maina uses three engines: Context, Prompt, and Verify.",
			"Context observes, Prompt learns, Verify verifies.",
		].join("\n"),
	);

	writeFileSync(
		join(wiki, "architecture", "verification-pipeline.md"),
		[
			"# Architecture: Verification Pipeline",
			"",
			"The verify pipeline has multiple stages: syntax guard, parallel tools, diff filter, AI fix, review.",
		].join("\n"),
	);
}

beforeEach(() => {
	tmpDir = createTmpDir();
	wikiDir = join(tmpDir, "wiki");
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

// ── consultWikiForPlan ─────────────────────────────────────────────────────

describe("consultWikiForPlan", () => {
	test("finds related modules by keyword", () => {
		seedWiki(wikiDir);
		const result = consultWikiForPlan(
			wikiDir,
			"improve the verify pipeline syntax checking",
		);

		expect(result.relatedModules.length).toBeGreaterThan(0);
		const verifyMod = result.relatedModules.find((m) => m.name === "verify");
		expect(verifyMod).toBeDefined();
		expect(verifyMod?.entities).toBe(11);
	});

	test("returns suggestions for modules with many entities", () => {
		seedWiki(wikiDir);
		const result = consultWikiForPlan(
			wikiDir,
			"improve the verify pipeline syntax checking",
		);

		const extendSuggestion = result.suggestions.find((s) =>
			s.includes("consider extending"),
		);
		expect(extendSuggestion).toBeDefined();
		expect(extendSuggestion).toContain("verify");
	});

	test("finds related decisions", () => {
		seedWiki(wikiDir);
		const result = consultWikiForPlan(
			wikiDir,
			"add multi-language linting support",
		);

		expect(result.relatedDecisions.length).toBeGreaterThan(0);
		const multiLang = result.relatedDecisions.find(
			(d) => d.id === "0002-multi-language-verify-pipeline",
		);
		expect(multiLang).toBeDefined();
		expect(multiLang?.status).toBe("accepted");
	});

	test("finds related features", () => {
		seedWiki(wikiDir);
		const result = consultWikiForPlan(
			wikiDir,
			"hardening improvements for verify gaps",
		);

		expect(result.relatedFeatures.length).toBeGreaterThan(0);
		const hardening = result.relatedFeatures.find((f) => f.id.includes("024"));
		expect(hardening).toBeDefined();
	});

	test("generates feature similarity suggestions", () => {
		seedWiki(wikiDir);
		const result = consultWikiForPlan(
			wikiDir,
			"hardening improvements for verify gaps",
		);

		const featureSuggestion = result.suggestions.find((s) =>
			s.includes("did something similar"),
		);
		expect(featureSuggestion).toBeDefined();
	});

	test("handles missing wiki gracefully", () => {
		const result = consultWikiForPlan("/nonexistent/wiki", "some feature");
		expect(result.relatedModules).toEqual([]);
		expect(result.relatedDecisions).toEqual([]);
		expect(result.relatedFeatures).toEqual([]);
		expect(result.suggestions).toEqual([]);
	});

	test("handles empty description", () => {
		seedWiki(wikiDir);
		const result = consultWikiForPlan(wikiDir, "");
		expect(result.relatedModules).toEqual([]);
	});
});

// ── consultWikiForDesign ───────────────────────────────────────────────────

describe("consultWikiForDesign", () => {
	test("detects conflicts with existing ADRs", () => {
		seedWiki(wikiDir);
		const result = consultWikiForDesign(
			wikiDir,
			"Use ESLint for linting TypeScript code instead of current tools",
		);

		expect(result.conflicts.length).toBeGreaterThan(0);
		const biomeConflict = result.conflicts.find((c) =>
			c.reason.includes("biome"),
		);
		expect(biomeConflict).toBeDefined();
	});

	test("detects alignments with existing ADRs", () => {
		seedWiki(wikiDir);
		const result = consultWikiForDesign(
			wikiDir,
			"Extend the verify pipeline to support multi-language linting with ruff",
		);

		expect(result.alignments.length).toBeGreaterThan(0);
	});

	test("handles missing wiki gracefully", () => {
		const result = consultWikiForDesign("/nonexistent/wiki", "some decision");
		expect(result.conflicts).toEqual([]);
		expect(result.alignments).toEqual([]);
	});

	test("handles empty proposal", () => {
		seedWiki(wikiDir);
		const result = consultWikiForDesign(wikiDir, "");
		expect(result.conflicts).toEqual([]);
		expect(result.alignments).toEqual([]);
	});
});

// ── consultWikiForBrainstorm ───────────────────────────────────────────────

describe("consultWikiForBrainstorm", () => {
	test("loads architecture context", () => {
		seedWiki(wikiDir);
		const result = consultWikiForBrainstorm(wikiDir);

		expect(result.architecture).toContain("Three Engines");
		expect(result.architecture).toContain("Verification Pipeline");
	});

	test("counts modules and decisions", () => {
		seedWiki(wikiDir);
		const result = consultWikiForBrainstorm(wikiDir);

		expect(result.moduleCount).toBe(2);
		expect(result.decisionCount).toBe(2);
	});

	test("loads recent features", () => {
		seedWiki(wikiDir);
		const result = consultWikiForBrainstorm(wikiDir);

		expect(result.recentFeatures.length).toBe(2);
		// Sorted descending by ID, so 024 comes first
		expect(result.recentFeatures[0]).toContain("024");
	});

	test("handles missing wiki gracefully", () => {
		const result = consultWikiForBrainstorm("/nonexistent/wiki");
		expect(result.architecture).toBe("");
		expect(result.moduleCount).toBe(0);
		expect(result.decisionCount).toBe(0);
		expect(result.recentFeatures).toEqual([]);
	});
});
