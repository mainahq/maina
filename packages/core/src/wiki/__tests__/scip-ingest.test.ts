import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	findTsConfigs,
	isScipAvailable,
	parseScipOutput,
	runScipTypescript,
} from "../scip-ingest";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		tmpdir(),
		`scip-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── isScipAvailable ─────────────────────────────────────────────────────

describe("isScipAvailable", () => {
	test("returns boolean without throwing", async () => {
		const result = await isScipAvailable();
		expect(typeof result).toBe("boolean");
	});
});

// ── findTsConfigs ───────────────────────────────────────────────────────

describe("findTsConfigs", () => {
	test("finds tsconfig.json at root", () => {
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}");
		const configs = findTsConfigs(tmpDir);
		expect(configs).toHaveLength(1);
		expect(configs[0]).toContain("tsconfig.json");
	});

	test("finds nested tsconfig.json in monorepo", () => {
		mkdirSync(join(tmpDir, "packages", "core"), { recursive: true });
		mkdirSync(join(tmpDir, "packages", "cli"), { recursive: true });
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}");
		writeFileSync(join(tmpDir, "packages", "core", "tsconfig.json"), "{}");
		writeFileSync(join(tmpDir, "packages", "cli", "tsconfig.json"), "{}");

		const configs = findTsConfigs(tmpDir);
		expect(configs).toHaveLength(3);
	});

	test("skips node_modules", () => {
		mkdirSync(join(tmpDir, "node_modules", "pkg"), { recursive: true });
		writeFileSync(join(tmpDir, "node_modules", "pkg", "tsconfig.json"), "{}");
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}");

		const configs = findTsConfigs(tmpDir);
		expect(configs).toHaveLength(1);
	});

	test("returns empty for no tsconfigs", () => {
		expect(findTsConfigs(tmpDir)).toEqual([]);
	});

	test("respects maxDepth", () => {
		mkdirSync(join(tmpDir, "a", "b", "c", "d"), { recursive: true });
		writeFileSync(join(tmpDir, "a", "b", "c", "d", "tsconfig.json"), "{}");

		// maxDepth 2 should not find depth-4 tsconfig
		const configs = findTsConfigs(tmpDir, 2);
		expect(configs).toHaveLength(0);
	});
});

// ── parseScipOutput ─────────────────────────────────────────────────────

describe("parseScipOutput", () => {
	test("parses valid SCIP JSON output", () => {
		const json = JSON.stringify({
			documents: [
				{
					relativePath: "src/index.ts",
					occurrences: [
						{
							symbol: "npm pkg 1.0.0 src/index.ts/hello().",
							range: [10, 0, 10, 5],
							symbolRoles: 1,
						},
					],
				},
			],
		});

		const result = parseScipOutput(json);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.length).toBeGreaterThanOrEqual(1);
			expect(result.value[0]?.name).toBe("hello");
			expect(result.value[0]?.file).toBe("src/index.ts");
			expect(result.value[0]?.line).toBe(11); // 0-indexed → 1-indexed
		}
	});

	test("returns empty for no documents", () => {
		const result = parseScipOutput(JSON.stringify({ documents: [] }));
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});

	test("returns error for invalid JSON", () => {
		const result = parseScipOutput("not json");
		expect(result.ok).toBe(false);
	});

	test("handles missing fields gracefully", () => {
		const json = JSON.stringify({
			documents: [{ relativePath: "a.ts", occurrences: [{}] }],
		});
		const result = parseScipOutput(json);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toEqual([]);
	});
});

// ── runScipTypescript ───────────────────────────────────────────────────

describe("runScipTypescript", () => {
	test("returns error for repo with no tsconfig", async () => {
		const result = await runScipTypescript(tmpDir);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.error.includes("not installed") ||
					result.error.includes("No tsconfig"),
			).toBe(true);
		}
	});
});
