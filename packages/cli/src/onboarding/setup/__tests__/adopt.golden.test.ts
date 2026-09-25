/**
 * Golden-path test for `adopt()` — reads a fixture repo with a 20+ line
 * AGENTS.md and asserts ≥ 80 % of unique rule sentences carry through with
 * provenance metadata.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptRules, formatProvenanceComment } from "../adopt";

function makeTmpDir(prefix: string): string {
	const dir = join(
		tmpdir(),
		`maina-adopt-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

const AGENTS_MD_FIXTURE = `# AGENTS.md

This repo uses Maina for verification-first development.

## Conventions

- TDD always. Write tests first, watch them fail, implement, watch them pass.
- Use conventional commits. Scopes must be one of cli, core, mcp, skills.
- Error handling uses Result<T, E>. Never throw.
- No console.log in production code.
- Diff-only reporting: only report findings on changed lines.
- WHAT/WHY lives in spec.md. HOW lives in plan.md. Never mix them.
- Use [NEEDS CLARIFICATION] markers for ambiguity. Never guess.

## Testing

- All DB access through the repository layer.
- API responses use the { data, error, meta } envelope.
- Tests use bun:test, not Jest or Vitest.
- Coverage target is 80% for core modules.

## Style

- TypeScript strict mode is required.
- Biome is the formatter. Do not mix Prettier.
- Imports are alphabetised.
- File names use kebab-case.

## Security

- Never commit secrets or credentials.
- Run Trivy on lockfile changes.
- Sanitise user input before logging.
- Rotate API keys every 90 days.
- Pin dependency versions exactly.
- Use environment variables for configuration.
`;

describe("adoptRules — golden path", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir("golden");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("≥ 80 % of AGENTS.md rule sentences carry through", async () => {
		writeFileSync(join(tmpDir, "AGENTS.md"), AGENTS_MD_FIXTURE);

		const result = await adoptRules(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// Count bullet lines in the fixture: each `- ` bullet is one rule.
		const bulletCount = AGENTS_MD_FIXTURE.split("\n").filter((l) =>
			/^-\s+\S/.test(l),
		).length;
		expect(bulletCount).toBeGreaterThanOrEqual(20);

		const adopted = result.value;
		const carryover = adopted.length / bulletCount;
		expect(carryover).toBeGreaterThanOrEqual(0.8);
	});

	test("every adopted rule has provenance metadata", async () => {
		writeFileSync(join(tmpDir, "AGENTS.md"), AGENTS_MD_FIXTURE);

		const result = await adoptRules(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		for (const rule of result.value) {
			expect(rule.source).toMatch(/^AGENTS\.md:L\d+(-L\d+)?$/);
			expect(rule.sourceKind).toBe("AGENTS.md");
			expect(rule.confidence).toBe(1.0);
			expect(rule.text.length).toBeGreaterThan(0);
			// `formatProvenanceComment` must produce a well-formed HTML comment.
			const comment = formatProvenanceComment(rule);
			expect(comment).toMatch(
				/^<!-- source: AGENTS\.md:L\d+(-L\d+)?, confidence: 1\.0 -->$/,
			);
		}
	});

	test("reads CLAUDE.md alongside AGENTS.md", async () => {
		writeFileSync(join(tmpDir, "AGENTS.md"), AGENTS_MD_FIXTURE);
		writeFileSync(
			join(tmpDir, "CLAUDE.md"),
			"# CLAUDE.md\n\n- Always use maina commit, never raw git.\n- Never skip verify.\n",
		);

		const result = await adoptRules(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const sources = new Set(result.value.map((r) => r.sourceKind));
		expect(sources.has("AGENTS.md")).toBe(true);
		expect(sources.has("CLAUDE.md")).toBe(true);
	});

	test("reads .cursorrules", async () => {
		writeFileSync(
			join(tmpDir, ".cursorrules"),
			"- Cursor rule one.\n- Cursor rule two.\n",
		);
		const result = await adoptRules(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.some((r) => r.sourceKind === ".cursorrules")).toBe(
			true,
		);
	});

	test("reads .cursor/rules/*.mdc files", async () => {
		mkdirSync(join(tmpDir, ".cursor", "rules"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".cursor", "rules", "main.mdc"),
			"- Rule from mdc file.\n- Another one.\n",
		);
		const result = await adoptRules(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.some((r) => r.sourceKind === ".cursor/rules")).toBe(
			true,
		);
	});

	test("reads .windsurfrules + .windsurf/rules/*", async () => {
		writeFileSync(join(tmpDir, ".windsurfrules"), "- Windsurf root rule.\n");
		mkdirSync(join(tmpDir, ".windsurf", "rules"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".windsurf", "rules", "general.md"),
			"- Sub-rule in windsurf dir.\n",
		);
		const result = await adoptRules(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const sources = new Set(result.value.map((r) => r.sourceKind));
		expect(sources.has(".windsurfrules")).toBe(true);
		expect(sources.has(".windsurf/rules")).toBe(true);
	});

	test("reads .github/copilot-instructions.md", async () => {
		mkdirSync(join(tmpDir, ".github"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".github", "copilot-instructions.md"),
			"- Copilot: follow Biome.\n- Copilot: write tests.\n",
		);
		const result = await adoptRules(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(
			result.value.some(
				(r) => r.sourceKind === ".github/copilot-instructions.md",
			),
		).toBe(true);
	});

	test("reads CONTRIBUTING.md and CONTEXT.md", async () => {
		writeFileSync(
			join(tmpDir, "CONTRIBUTING.md"),
			"# Contributing\n\n- Please rebase before pushing.\n- Squash merge only.\n",
		);
		writeFileSync(
			join(tmpDir, "CONTEXT.md"),
			"# Context\n\n- Service boundaries live in packages/.\n",
		);
		const result = await adoptRules(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const sources = new Set(result.value.map((r) => r.sourceKind));
		expect(sources.has("CONTRIBUTING.md")).toBe(true);
		expect(sources.has("CONTEXT.md")).toBe(true);
	});

	test("empty repo yields empty array, no error", async () => {
		const result = await adoptRules(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual([]);
	});

	test("de-duplicates identical text across files (keeps earliest source)", async () => {
		writeFileSync(
			join(tmpDir, "AGENTS.md"),
			"# Rules\n\n- No console.log in production code.\n",
		);
		writeFileSync(
			join(tmpDir, "CLAUDE.md"),
			"# Claude\n\n- No console.log in production code.\n",
		);
		const result = await adoptRules(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const matches = result.value.filter((r) =>
			r.text.toLowerCase().includes("no console.log"),
		);
		expect(matches.length).toBe(1);
		// The earliest file we scan (AGENTS.md) wins.
		expect(matches[0]?.sourceKind).toBe("AGENTS.md");
	});
});
