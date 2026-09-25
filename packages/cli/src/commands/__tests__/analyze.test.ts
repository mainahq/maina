import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// ── Mock State ───────────────────────────────────────────────────────────────

// We use dependency injection rather than mock.module for this command,
// matching the AnalyzeDeps interface pattern.

// ── Import the module under test ────────────────────────────────────────────

import type { AnalyzeDeps } from "../analyze";
import { analyzeAction } from "../analyze";

// ── Test helpers ────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-analyze-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

// ── Mock deps factory ───────────────────────────────────────────────────────

type AnalyzeReturn = ReturnType<AnalyzeDeps["analyze"]>;

function createMockDeps(overrides?: {
	getCurrentBranch?: (cwd: string) => Promise<string>;
	analyze?: (featureDir: string) => AnalyzeReturn;
}): AnalyzeDeps {
	return {
		getCurrentBranch: overrides?.getCurrentBranch ?? (async () => "main"),
		analyze:
			overrides?.analyze ??
			((featureDir: string) => ({
				ok: true as const,
				value: {
					featureDir,
					findings: [],
					summary: { errors: 0, warnings: 0, info: 0 },
				},
			})),
	};
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("analyzeAction", () => {
	test("single feature with no findings returns passed = true", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });

		const deps = createMockDeps({
			analyze: (dir) => ({
				ok: true,
				value: {
					featureDir: dir,
					findings: [],
					summary: { errors: 0, warnings: 0, info: 0 },
				},
			}),
		});

		const result = await analyzeAction({ featureDir, cwd: tmpDir }, deps);

		expect(result.analyzed).toBe(true);
		expect(result.passed).toBe(true);
		expect(result.reports).toBeDefined();
		expect(result.reports?.length).toBe(1);
		expect(result.reports?.[0]?.errors).toBe(0);
	});

	test("single feature with errors returns passed = false", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });

		const deps = createMockDeps({
			analyze: (dir) => ({
				ok: true,
				value: {
					featureDir: dir,
					findings: [
						{
							severity: "error",
							category: "spec-coverage",
							message: 'Acceptance criterion "password reset" not covered',
						},
					],
					summary: { errors: 1, warnings: 0, info: 0 },
				},
			}),
		});

		const result = await analyzeAction({ featureDir, cwd: tmpDir }, deps);

		expect(result.analyzed).toBe(true);
		expect(result.passed).toBe(false);
		expect(result.reports?.[0]?.errors).toBe(1);
	});

	test("single feature with only warnings returns passed = true", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });

		const deps = createMockDeps({
			analyze: (dir) => ({
				ok: true,
				value: {
					featureDir: dir,
					findings: [
						{
							severity: "warning",
							category: "orphaned-task",
							message: "Task T005 does not map to any requirement",
						},
						{
							severity: "warning",
							category: "separation-violation",
							message: 'spec.md contains implementation keyword "JWT"',
							file: "spec.md",
							line: 15,
						},
					],
					summary: { errors: 0, warnings: 2, info: 0 },
				},
			}),
		});

		const result = await analyzeAction({ featureDir, cwd: tmpDir }, deps);

		expect(result.analyzed).toBe(true);
		expect(result.passed).toBe(true);
		expect(result.reports?.[0]?.warnings).toBe(2);
		expect(result.reports?.[0]?.errors).toBe(0);
	});

	test("auto-detects feature dir from branch name", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });

		let analyzedDir: string | undefined;
		const deps = createMockDeps({
			getCurrentBranch: async () => "feature/001-user-auth",
			analyze: (dir) => {
				analyzedDir = dir;
				return {
					ok: true,
					value: {
						featureDir: dir,
						findings: [],
						summary: { errors: 0, warnings: 0, info: 0 },
					},
				};
			},
		});

		const result = await analyzeAction({ cwd: tmpDir }, deps);

		expect(result.analyzed).toBe(true);
		expect(analyzedDir).toBe(featureDir);
	});

	test("explicit feature dir overrides auto-detect", async () => {
		// Create both dirs — auto-detect would find 001, but we pass 002 explicitly
		const autoDir = join(tmpDir, ".maina", "features", "001-user-auth");
		const explicitDir = join(tmpDir, ".maina", "features", "002-payments");
		mkdirSync(autoDir, { recursive: true });
		mkdirSync(explicitDir, { recursive: true });

		let analyzedDir: string | undefined;
		const deps = createMockDeps({
			getCurrentBranch: async () => "feature/001-user-auth",
			analyze: (dir) => {
				analyzedDir = dir;
				return {
					ok: true,
					value: {
						featureDir: dir,
						findings: [],
						summary: { errors: 0, warnings: 0, info: 0 },
					},
				};
			},
		});

		const result = await analyzeAction(
			{ featureDir: explicitDir, cwd: tmpDir },
			deps,
		);

		expect(result.analyzed).toBe(true);
		expect(analyzedDir).toBe(explicitDir);
	});

	test("--all flag analyzes multiple features", async () => {
		// Create multiple feature dirs
		const dir1 = join(tmpDir, ".maina", "features", "001-user-auth");
		const dir2 = join(tmpDir, ".maina", "features", "002-payments");
		const dir3 = join(tmpDir, ".maina", "features", "003-notifications");
		mkdirSync(dir1, { recursive: true });
		mkdirSync(dir2, { recursive: true });
		mkdirSync(dir3, { recursive: true });

		const analyzedDirs: string[] = [];
		const deps = createMockDeps({
			analyze: (dir) => {
				analyzedDirs.push(dir);
				return {
					ok: true,
					value: {
						featureDir: dir,
						findings: [],
						summary: { errors: 0, warnings: 0, info: 0 },
					},
				};
			},
		});

		const result = await analyzeAction({ all: true, cwd: tmpDir }, deps);

		expect(result.analyzed).toBe(true);
		expect(result.reports?.length).toBe(3);
		expect(analyzedDirs.length).toBe(3);
		expect(result.passed).toBe(true);
	});

	test("missing feature dir returns error", async () => {
		// No .maina/features directory at all
		const deps = createMockDeps({
			getCurrentBranch: async () => "feature/001-user-auth",
		});

		const result = await analyzeAction({ cwd: tmpDir }, deps);

		expect(result.analyzed).toBe(false);
		expect(result.reason).toBeDefined();
	});

	test("non-feature branch with no --feature-dir returns error", async () => {
		const deps = createMockDeps({
			getCurrentBranch: async () => "main",
		});

		const result = await analyzeAction({ cwd: tmpDir }, deps);

		expect(result.analyzed).toBe(false);
		expect(result.reason).toBeDefined();
		expect(result.reason).toContain("main");
	});

	// Match on the feature folder name only; the temp root embeds Date.now()
	// and may itself contain "001"/"002" (#435).
	const isFeature = (dir: string, id: string) =>
		basename(dir).startsWith(`${id}-`);

	async function expectSummaryCountsAcrossFeatures(root: string) {
		const dir1 = join(root, ".maina", "features", "001-user-auth");
		const dir2 = join(root, ".maina", "features", "002-payments");
		mkdirSync(dir1, { recursive: true });
		mkdirSync(dir2, { recursive: true });

		const deps = createMockDeps({
			analyze: (dir) => {
				if (isFeature(dir, "001")) {
					return {
						ok: true,
						value: {
							featureDir: dir,
							findings: [
								{
									severity: "error",
									category: "spec-coverage",
									message: "Missing coverage",
								},
								{
									severity: "warning",
									category: "orphaned-task",
									message: "Orphaned",
								},
							],
							summary: { errors: 1, warnings: 1, info: 0 },
						},
					};
				}
				return {
					ok: true,
					value: {
						featureDir: dir,
						findings: [
							{
								severity: "warning",
								category: "separation-violation",
								message: "Separation issue",
							},
							{
								severity: "info",
								category: "missing-file",
								message: "tasks.md not found",
							},
						],
						summary: { errors: 0, warnings: 1, info: 1 },
					},
				};
			},
		});

		const result = await analyzeAction({ all: true, cwd: root }, deps);

		expect(result.analyzed).toBe(true);
		expect(result.reports?.length).toBe(2);

		// Feature 001
		const report001 = result.reports?.find((r) =>
			isFeature(r.featureDir, "001"),
		);
		expect(report001?.errors).toBe(1);
		expect(report001?.warnings).toBe(1);

		// Feature 002
		const report002 = result.reports?.find((r) =>
			isFeature(r.featureDir, "002"),
		);
		expect(report002?.errors).toBe(0);
		expect(report002?.warnings).toBe(1);

		// Overall: has errors, so passed = false
		expect(result.passed).toBe(false);
	}

	test("summary counts are correct across multiple features", async () => {
		await expectSummaryCountsAcrossFeatures(tmpDir);
	});

	test("summary counts match by feature folder even when the temp path contains feature numbers", async () => {
		// Regression for #435: tmpDir embeds Date.now(), which can contain "001"
		// or "002". Force that collision deterministically.
		await expectSummaryCountsAcrossFeatures(join(tmpDir, "run-002-001"));
	});

	test("findings count includes all findings per feature", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });

		const deps = createMockDeps({
			analyze: (dir) => ({
				ok: true,
				value: {
					featureDir: dir,
					findings: [
						{
							severity: "error",
							category: "spec-coverage",
							message: "Missing",
						},
						{
							severity: "warning",
							category: "orphaned-task",
							message: "Orphaned",
						},
						{
							severity: "info",
							category: "missing-file",
							message: "No tasks.md",
						},
					],
					summary: { errors: 1, warnings: 1, info: 1 },
				},
			}),
		});

		const result = await analyzeAction({ featureDir, cwd: tmpDir }, deps);

		expect(result.reports?.[0]?.findings).toBe(3);
	});

	test("--all with no feature directories returns error", async () => {
		// Create .maina/features but leave it empty
		mkdirSync(join(tmpDir, ".maina", "features"), { recursive: true });

		const deps = createMockDeps();

		const result = await analyzeAction({ all: true, cwd: tmpDir }, deps);

		expect(result.analyzed).toBe(false);
		expect(result.reason).toBeDefined();
	});

	test("analyze failure for a feature dir is reported", async () => {
		const featureDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(featureDir, { recursive: true });

		const deps = createMockDeps({
			analyze: () => ({
				ok: false as const,
				error: "Feature directory does not exist",
			}),
		});

		const result = await analyzeAction({ featureDir, cwd: tmpDir }, deps);

		expect(result.analyzed).toBe(false);
		expect(result.reason).toContain("Feature directory does not exist");
	});
});

// ── Spec Kit feature input (FR-SPEC-7) ──────────────────────────────────────

describe("analyzeAction on a Spec Kit repository", () => {
	const noEnv = { get: (_name: string) => undefined };

	function specKitRepo(features: readonly string[]): void {
		mkdirSync(join(tmpDir, ".specify"), { recursive: true });
		for (const name of features) {
			mkdirSync(join(tmpDir, "specs", name), { recursive: true });
		}
	}

	function recordingDeps(branch: string) {
		const analyzed: string[] = [];
		const deps = createMockDeps({
			getCurrentBranch: async () => branch,
			analyze: (dir) => {
				analyzed.push(dir);
				return {
					ok: true,
					value: {
						featureDir: dir,
						findings: [],
						summary: { errors: 0, warnings: 0, info: 0 },
					},
				};
			},
		});
		return { analyzed, deps };
	}

	test("reads the feature named in .specify/feature.json", async () => {
		specKitRepo(["001-photo-albums", "002-sharing"]);
		writeFileSync(
			join(tmpDir, ".specify", "feature.json"),
			JSON.stringify({ feature_directory: "specs/002-sharing" }),
		);
		const { analyzed, deps } = recordingDeps("main");

		const result = await analyzeAction({ cwd: tmpDir, env: noEnv }, deps);

		expect(result.analyzed).toBe(true);
		expect(analyzed).toEqual([join(tmpDir, "specs", "002-sharing")]);
	});

	test("matches a Spec Kit branch (NNN-name) to specs/NNN-name", async () => {
		specKitRepo(["001-photo-albums"]);
		const { analyzed, deps } = recordingDeps("001-photo-albums");

		const result = await analyzeAction({ cwd: tmpDir, env: noEnv }, deps);

		expect(result.analyzed).toBe(true);
		expect(analyzed).toEqual([join(tmpDir, "specs", "001-photo-albums")]);
	});

	test("SPECIFY_FEATURE_DIRECTORY overrides the branch", async () => {
		specKitRepo(["001-photo-albums", "002-sharing"]);
		const { analyzed, deps } = recordingDeps("001-photo-albums");
		const env = {
			get: (name: string) =>
				name === "SPECIFY_FEATURE_DIRECTORY" ? "specs/002-sharing" : undefined,
		};

		await analyzeAction({ cwd: tmpDir, env }, deps);

		expect(analyzed).toEqual([join(tmpDir, "specs", "002-sharing")]);
	});

	test("SPECIFY_FEATURE stands in for the branch", async () => {
		specKitRepo(["001-photo-albums", "002-sharing"]);
		const { analyzed, deps } = recordingDeps("main");
		const env = {
			get: (name: string) =>
				name === "SPECIFY_FEATURE" ? "002-sharing" : undefined,
		};

		await analyzeAction({ cwd: tmpDir, env }, deps);

		expect(analyzed).toEqual([join(tmpDir, "specs", "002-sharing")]);
	});

	test("a Maina feature branch still wins over Spec Kit", async () => {
		specKitRepo(["001-user-auth"]);
		const mainaDir = join(tmpDir, ".maina", "features", "001-user-auth");
		mkdirSync(mainaDir, { recursive: true });
		const { analyzed, deps } = recordingDeps("feature/001-user-auth");

		await analyzeAction({ cwd: tmpDir, env: noEnv }, deps);

		expect(analyzed).toEqual([mainaDir]);
	});

	test("--all includes the numbered Spec Kit features", async () => {
		specKitRepo(["001-photo-albums", "002-sharing"]);
		mkdirSync(join(tmpDir, ".maina", "features", "001-user-auth"), {
			recursive: true,
		});
		const { analyzed, deps } = recordingDeps("main");

		const result = await analyzeAction(
			{ all: true, cwd: tmpDir, env: noEnv },
			deps,
		);

		expect(result.analyzed).toBe(true);
		expect(analyzed).toEqual([
			join(tmpDir, ".maina", "features", "001-user-auth"),
			join(tmpDir, "specs", "001-photo-albums"),
			join(tmpDir, "specs", "002-sharing"),
		]);
	});

	test("specs/ without .specify/ is not a Spec Kit repository", async () => {
		mkdirSync(join(tmpDir, "specs", "001-photo-albums"), { recursive: true });
		const { analyzed, deps } = recordingDeps("001-photo-albums");

		const result = await analyzeAction({ cwd: tmpDir, env: noEnv }, deps);

		expect(result.analyzed).toBe(false);
		expect(analyzed).toEqual([]);
	});

	test("an unreadable feature.json is reported, not guessed around", async () => {
		specKitRepo(["001-photo-albums"]);
		writeFileSync(join(tmpDir, ".specify", "feature.json"), "{broken");
		const { analyzed, deps } = recordingDeps("001-photo-albums");

		const result = await analyzeAction({ cwd: tmpDir, env: noEnv }, deps);

		expect(result.analyzed).toBe(false);
		expect(result.reason).toContain("feature.json");
		expect(analyzed).toEqual([]);
	});
});
