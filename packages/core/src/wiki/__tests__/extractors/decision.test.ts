import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	extractDecisions,
	extractSingleDecision,
} from "../../extractors/decision";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`wiki-decision-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("Decision Extractor", () => {
	describe("extractSingleDecision", () => {
		it("happy path: should extract a full ADR", () => {
			const adrPath = join(tmpDir, "0002-jwt-strategy.md");
			writeFileSync(
				adrPath,
				[
					"# ADR-0002: Use JWT for Authentication",
					"",
					"## Status",
					"Accepted",
					"",
					"## Context",
					"We need stateless auth for microservices.",
					"",
					"## Decision",
					"Use JWT tokens with RS256 signing.",
					"",
					"## Rationale",
					"Stateless, scalable, widely supported.",
					"",
					"## Alternatives Considered",
					"- Session-based auth — rejected because stateful",
					"- OAuth2 only — rejected because too complex",
					"",
					"## Entities",
					"- src/auth/jwt.ts",
					"- src/middleware/auth.ts",
				].join("\n"),
			);

			const result = extractSingleDecision(adrPath);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.id).toBe("0002-jwt-strategy");
			expect(result.value.title).toBe("Use JWT for Authentication");
			expect(result.value.status).toBe("accepted");
			expect(result.value.context).toContain("stateless auth");
			expect(result.value.decision).toContain("JWT tokens");
			expect(result.value.rationale).toContain("Stateless");
			expect(result.value.alternativesRejected).toHaveLength(2);
			expect(result.value.entityMentions).toHaveLength(2);
		});

		it("should handle ADR with minimal sections", () => {
			const adrPath = join(tmpDir, "0001-simple.md");
			writeFileSync(
				adrPath,
				[
					"# ADR-0001: Simple Decision",
					"",
					"## Status",
					"Proposed",
					"",
					"## Decision",
					"Do the thing.",
				].join("\n"),
			);

			const result = extractSingleDecision(adrPath);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.id).toBe("0001-simple");
			expect(result.value.status).toBe("proposed");
			expect(result.value.alternativesRejected).toHaveLength(0);
		});

		it("should normalize status to lowercase", () => {
			const adrPath = join(tmpDir, "0003-caps.md");
			writeFileSync(
				adrPath,
				"# ADR-0003: Caps Status\n\n## Status\nDEPRECATED\n\n## Decision\nOld thing.",
			);

			const result = extractSingleDecision(adrPath);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.status).toBe("deprecated");
		});

		it("should handle superseded status", () => {
			const adrPath = join(tmpDir, "0004-old.md");
			writeFileSync(
				adrPath,
				"# ADR-0004: Old Decision\n\n## Status\nSuperseded by ADR-0005\n\n## Decision\nOld approach.",
			);

			const result = extractSingleDecision(adrPath);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value.status).toBe("superseded");
		});

		it("edge case: non-existent file returns error", () => {
			const result = extractSingleDecision(join(tmpDir, "nonexistent.md"));
			expect(result.ok).toBe(false);
		});
	});

	describe("extractDecisions", () => {
		it("should extract all ADRs from a directory", () => {
			writeFileSync(
				join(tmpDir, "0001-first.md"),
				"# ADR-0001: First\n\n## Status\nAccepted\n\n## Decision\nDo A.",
			);
			writeFileSync(
				join(tmpDir, "0002-second.md"),
				"# ADR-0002: Second\n\n## Status\nProposed\n\n## Decision\nDo B.",
			);

			const result = extractDecisions(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value).toHaveLength(2);
		});

		it("should skip non-markdown files", () => {
			writeFileSync(join(tmpDir, "README.txt"), "Not an ADR");
			writeFileSync(
				join(tmpDir, "0001-real.md"),
				"# ADR-0001: Real\n\n## Status\nAccepted\n\n## Decision\nX.",
			);

			const result = extractDecisions(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toHaveLength(1);
		});

		it("should return empty array for empty directory", () => {
			const result = extractDecisions(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toHaveLength(0);
		});

		it("should return error for non-existent directory", () => {
			const result = extractDecisions(join(tmpDir, "nonexistent"));
			expect(result.ok).toBe(false);
		});
	});

	describe("dogfood: extract from maina's own ADRs", () => {
		it("should extract decisions from maina's adr/ directory", () => {
			const adrDir = join(process.cwd(), "adr");

			const result = extractDecisions(adrDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.length).toBeGreaterThan(0);
			for (const d of result.value) {
				expect(d.id).toBeTruthy();
				expect(d.title).toBeTruthy();
			}
		});
	});
});
