import { describe, expect, it } from "bun:test";
import corpus from "../../../../public/gate-corpus.json";
import { type CorpusRow, lookupCommand, normalizeCommand } from "../gate";

const rows = corpus as unknown as readonly CorpusRow[];

describe("normalizeCommand", () => {
	it("trims and collapses runs of whitespace", () => {
		expect(normalizeCommand("  rm   -rf \t ~  ")).toBe("rm -rf ~");
	});
});

describe("lookupCommand", () => {
	it("finds a corpus command however it is spaced", () => {
		const row = lookupCommand(rows, "  rm   -rf ~ ");
		expect(row?.c).toBe("rm -rf ~");
		expect(["ask", "deny"]).toContain(row?.v ?? "");
	});

	it("returns null for a command the build did not evaluate", () => {
		expect(lookupCommand(rows, "echo not-in-the-corpus-360")).toBeNull();
	});

	it("carries a verdict, a reason and the classes for every row", () => {
		expect(rows.length).toBeGreaterThan(500);
		for (const row of rows) {
			expect(["allow", "ask", "deny"]).toContain(row.v);
			expect(typeof row.r).toBe("string");
			expect(Array.isArray(row.k)).toBe(true);
		}
	});
});
