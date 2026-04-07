import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	extractFeatures,
	extractSingleFeature,
} from "../../extractors/feature";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`wiki-feature-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("Feature Extractor", () => {
	describe("extractSingleFeature", () => {
		it("happy path: should extract from plan.md + spec.md + tasks.md", () => {
			const featureDir = join(tmpDir, "001-token-refresh");
			mkdirSync(featureDir, { recursive: true });

			writeFileSync(
				join(featureDir, "plan.md"),
				[
					"# Implementation Plan: Token Refresh",
					"",
					"## Architecture",
					"- Pattern: Background timer with JWT rotation",
					"",
					"## Tasks",
					"- [ ] T001: Add refresh timer",
					"- [x] T002: Wire error handler",
				].join("\n"),
			);

			writeFileSync(
				join(featureDir, "spec.md"),
				[
					"# Feature: Token Refresh",
					"",
					"## Acceptance Criteria",
					"- [ ] Tokens refresh 5 minutes before expiry",
					"- [ ] Failed refresh triggers re-login",
					"",
					"## Scope",
					"Add automatic JWT token refresh to the auth module",
				].join("\n"),
			);

			writeFileSync(
				join(featureDir, "tasks.md"),
				[
					"# Task Breakdown",
					"",
					"## Tasks",
					"- [ ] T001: Add refresh timer",
					"- [x] T002: Wire error handler",
				].join("\n"),
			);

			const result = extractSingleFeature(featureDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.id).toBe("001-token-refresh");
			expect(result.value.title).toBe("Token Refresh");
			expect(result.value.scope).toContain("JWT token refresh");
			expect(result.value.tasks).toHaveLength(2);
			expect(result.value.tasks[0]?.completed).toBe(false);
			expect(result.value.tasks[1]?.completed).toBe(true);
			expect(result.value.specAssertions).toHaveLength(2);
		});

		it("should extract from plan.md only when spec and tasks are missing", () => {
			const featureDir = join(tmpDir, "002-simple");
			mkdirSync(featureDir, { recursive: true });

			writeFileSync(
				join(featureDir, "plan.md"),
				[
					"# Implementation Plan: Simple Feature",
					"",
					"## Tasks",
					"- [ ] T001: Do the thing",
				].join("\n"),
			);

			const result = extractSingleFeature(featureDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.id).toBe("002-simple");
			expect(result.value.title).toBe("Simple Feature");
			expect(result.value.specAssertions).toHaveLength(0);
		});

		it("edge case: empty feature directory", () => {
			const featureDir = join(tmpDir, "003-empty");
			mkdirSync(featureDir, { recursive: true });

			const result = extractSingleFeature(featureDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value.id).toBe("003-empty");
			expect(result.value.title).toBe("");
			expect(result.value.tasks).toHaveLength(0);
		});

		it("edge case: non-existent directory returns error", () => {
			const result = extractSingleFeature(join(tmpDir, "nonexistent"));
			expect(result.ok).toBe(false);
		});
	});

	describe("extractFeatures", () => {
		it("should extract all features from a features directory", () => {
			// Create two features
			const feat1 = join(tmpDir, "001-auth");
			mkdirSync(feat1, { recursive: true });
			writeFileSync(
				join(feat1, "plan.md"),
				"# Implementation Plan: Auth\n\n## Tasks\n- [ ] T001: Login",
			);

			const feat2 = join(tmpDir, "002-cache");
			mkdirSync(feat2, { recursive: true });
			writeFileSync(
				join(feat2, "plan.md"),
				"# Implementation Plan: Cache\n\n## Tasks\n- [ ] T001: LRU",
			);

			const result = extractFeatures(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			expect(result.value).toHaveLength(2);
			expect(result.value.map((f) => f.id)).toContain("001-auth");
			expect(result.value.map((f) => f.id)).toContain("002-cache");
		});

		it("should return empty array for empty features directory", () => {
			const result = extractFeatures(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toHaveLength(0);
		});

		it("should skip non-directory entries", () => {
			writeFileSync(join(tmpDir, "README.md"), "# Features");
			const feat1 = join(tmpDir, "001-auth");
			mkdirSync(feat1, { recursive: true });
			writeFileSync(join(feat1, "plan.md"), "# Implementation Plan: Auth");

			const result = extractFeatures(tmpDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toHaveLength(1);
		});
	});

	describe("dogfood: extract from maina's own features", () => {
		it("should extract features from maina's .maina/features/", () => {
			const mainaFeaturesDir = join(process.cwd(), ".maina", "features");

			const result = extractFeatures(mainaFeaturesDir);
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			// Maina has 35+ features at this point
			expect(result.value.length).toBeGreaterThan(0);
			// Each feature should have an id
			for (const f of result.value) {
				expect(f.id).toBeTruthy();
			}
		});
	});
});
