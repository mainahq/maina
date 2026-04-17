import { describe, expect, test } from "bun:test";
import type { CodeEntity } from "../extractors/code";
import type { SymbolRef } from "../symbol-page";
import {
	formatLocation,
	formatMermaidDiagram,
	formatRefs,
	formatSignature,
	generateSymbolPage,
} from "../symbol-page";

const sampleEntity: CodeEntity = {
	name: "runPipeline",
	kind: "function",
	file: "src/verify/pipeline.ts",
	line: 42,
	exported: true,
};

const sampleRefs: SymbolRef[] = [
	{
		name: "syntaxGuard",
		file: "src/verify/syntax.ts",
		line: 10,
		direction: "outbound",
	},
	{
		name: "commitCommand",
		file: "src/commands/commit.ts",
		line: 55,
		direction: "inbound",
	},
];

// ── formatSignature ─────────────────────────────────────────────────────

describe("formatSignature", () => {
	test("shows kind and export status", () => {
		const result = formatSignature(sampleEntity);
		expect(result).toContain("## runPipeline");
		expect(result).toContain("Function");
		expect(result).toContain("exported");
	});

	test("shows internal for non-exported", () => {
		const result = formatSignature({ ...sampleEntity, exported: false });
		expect(result).toContain("internal");
	});

	test("handles all entity kinds", () => {
		const kinds: CodeEntity["kind"][] = [
			"function",
			"class",
			"interface",
			"type",
			"variable",
			"enum",
		];
		for (const kind of kinds) {
			const result = formatSignature({ ...sampleEntity, kind });
			expect(result).toContain("##");
		}
	});
});

// ── formatLocation ──────────────────────────────────────────────────────

describe("formatLocation", () => {
	test("shows file:line", () => {
		const result = formatLocation(sampleEntity);
		expect(result).toContain("src/verify/pipeline.ts:42");
	});
});

// ── formatRefs ──────────────────────────────────────────────────────────

describe("formatRefs", () => {
	test("shows inbound and outbound sections", () => {
		const result = formatRefs(sampleRefs);
		expect(result).toContain("Callers (inbound)");
		expect(result).toContain("commitCommand");
		expect(result).toContain("Callees (outbound)");
		expect(result).toContain("syntaxGuard");
	});

	test("shows 'no references' for empty refs", () => {
		const result = formatRefs([]);
		expect(result).toContain("No references found");
	});

	test("caps at 20 per direction", () => {
		const manyRefs: SymbolRef[] = Array.from({ length: 30 }, (_, i) => ({
			name: `fn${i}`,
			file: `src/f${i}.ts`,
			line: i,
			direction: "inbound" as const,
		}));
		const result = formatRefs(manyRefs);
		const matches = result.match(/fn\d+/g) ?? [];
		expect(matches.length).toBeLessThanOrEqual(20);
	});
});

// ── formatMermaidDiagram ────────────────────────────────────────────────

describe("formatMermaidDiagram", () => {
	test("generates Mermaid graph LR diagram", () => {
		const result = formatMermaidDiagram(sampleEntity, sampleRefs);
		expect(result).toContain("```mermaid");
		expect(result).toContain("graph LR");
		expect(result).toContain("runPipeline");
		expect(result).toContain("syntaxGuard");
		expect(result).toContain("commitCommand");
		expect(result).toContain("```");
	});

	test("returns empty string for no refs", () => {
		expect(formatMermaidDiagram(sampleEntity, [])).toBe("");
	});

	test("shows correct arrow direction", () => {
		const result = formatMermaidDiagram(sampleEntity, sampleRefs);
		// inbound: caller --> entity
		expect(result).toContain('commitCommand["commitCommand"] --> runPipeline');
		// outbound: entity --> callee
		expect(result).toContain('runPipeline["runPipeline"] --> syntaxGuard');
	});
});

// ── generateSymbolPage ──────────────────────────────────────────────────

describe("generateSymbolPage", () => {
	test("combines all sections", async () => {
		const page = await generateSymbolPage(sampleEntity, sampleRefs, {
			skipProse: true,
		});
		expect(page).toContain("## runPipeline");
		expect(page).toContain("Function");
		expect(page).toContain("pipeline.ts:42");
		expect(page).toContain("Callers");
		expect(page).toContain("```mermaid");
	});

	test("works with no refs", async () => {
		const page = await generateSymbolPage(sampleEntity, [], {
			skipProse: true,
		});
		expect(page).toContain("## runPipeline");
		expect(page).toContain("No references found");
		expect(page).not.toContain("```mermaid");
	});

	test("output is deterministic without prose", async () => {
		const opts = { skipProse: true };
		const page1 = await generateSymbolPage(sampleEntity, sampleRefs, opts);
		const page2 = await generateSymbolPage(sampleEntity, sampleRefs, opts);
		expect(page1).toBe(page2);
	});

	test("works without mainaDir (no prose)", async () => {
		const page = await generateSymbolPage(sampleEntity, sampleRefs);
		expect(page).toContain("## runPipeline");
		// No prose section without mainaDir
		expect(page).toContain("Callers");
	});
});
