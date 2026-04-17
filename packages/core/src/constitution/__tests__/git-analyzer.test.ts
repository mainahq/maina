import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	analyzeCiWorkflows,
	analyzeCodeowners,
	analyzeCommitConventions,
	analyzeGitAndCi,
	analyzeHotPaths,
} from "../git-analyzer";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`git-analyzer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── analyzeCiWorkflows ──────────────────────────────────────────────────

describe("analyzeCiWorkflows", () => {
	test("extracts workflow names from yml files", () => {
		mkdirSync(join(tmpDir, ".github", "workflows"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".github", "workflows", "ci.yml"),
			"name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest",
		);
		writeFileSync(
			join(tmpDir, ".github", "workflows", "deploy.yaml"),
			"name: Deploy\non: [push]\njobs:\n  deploy:\n    runs-on: ubuntu-latest",
		);

		const rules = analyzeCiWorkflows(tmpDir);
		expect(rules.length).toBe(1);
		expect(rules[0]?.text).toContain("CI");
		expect(rules[0]?.text).toContain("Deploy");
		expect(rules[0]?.confidence).toBe(1.0);
	});

	test("returns empty for missing .github/workflows", () => {
		const rules = analyzeCiWorkflows(tmpDir);
		expect(rules.length).toBe(0);
	});
});

// ── analyzeCodeowners ───────────────────────────────────────────────────

describe("analyzeCodeowners", () => {
	test("detects CODEOWNERS at repo root", () => {
		writeFileSync(
			join(tmpDir, "CODEOWNERS"),
			"# Code owners\n*.ts @team-ts\n*.py @team-py\n",
		);

		const rules = analyzeCodeowners(tmpDir);
		expect(rules.length).toBe(1);
		expect(rules[0]?.text).toContain("CODEOWNERS");
		expect(rules[0]?.text).toContain("2 rules");
	});

	test("detects CODEOWNERS in .github/", () => {
		mkdirSync(join(tmpDir, ".github"), { recursive: true });
		writeFileSync(join(tmpDir, ".github", "CODEOWNERS"), "*.ts @lead\n");

		const rules = analyzeCodeowners(tmpDir);
		expect(rules.length).toBe(1);
	});

	test("returns empty when no CODEOWNERS", () => {
		const rules = analyzeCodeowners(tmpDir);
		expect(rules.length).toBe(0);
	});
});

// ── analyzeCommitConventions (uses real git) ────────────────────────────

describe("analyzeCommitConventions", () => {
	test("runs on actual repo without error", async () => {
		// Use the maina repo itself — may be shallow clone in CI
		const rules = await analyzeCommitConventions(process.cwd(), 50);
		// On full clone: should detect conventional commits
		// On shallow clone: may return empty (graceful degradation)
		expect(rules.length).toBeGreaterThanOrEqual(0);
		if (rules.length > 0) {
			expect(rules[0]?.text).toContain("Conventional commits");
		}
	});

	test("returns empty for non-git directory", async () => {
		const rules = await analyzeCommitConventions(tmpDir);
		expect(rules.length).toBe(0);
	});
});

// ── analyzeHotPaths (uses real git) ─────────────────────────────────────

describe("analyzeHotPaths", () => {
	test("runs on actual repo without error", async () => {
		const rules = await analyzeHotPaths(process.cwd(), 5);
		expect(rules.length).toBeGreaterThanOrEqual(0);
	});
});

// ── analyzeGitAndCi ─────────────────────────────────────────────────────

describe("analyzeGitAndCi", () => {
	test("combines all analyzers", async () => {
		// Use maina repo — has git history + CI workflows
		// On shallow clones, commit analysis may return empty
		const rules = await analyzeGitAndCi(process.cwd());
		expect(rules.length).toBeGreaterThanOrEqual(1);

		// CI workflows should always be detected (file-based, not git-dependent)
		const hasCi = rules.some((r) => r.text.includes("CI"));
		expect(hasCi).toBe(true);
	});
});
