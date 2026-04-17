import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleContext } from "../engine";

// Create a temporary .maina dir for tests
let tempMainaDir: string;
const repoRoot = process.cwd();

beforeAll(() => {
	tempMainaDir = join(tmpdir(), `maina-engine-test-${Date.now()}`);
	mkdirSync(join(tempMainaDir, "context"), { recursive: true });
});

afterAll(() => {
	try {
		rmSync(tempMainaDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors
	}
});

describe("assembleContext", () => {
	test("assembleContext('commit') returns an AssembledContext object", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			mainaDir: tempMainaDir,
		});

		expect(result).toBeDefined();
		expect(typeof result.text).toBe("string");
		expect(typeof result.tokens).toBe("number");
		expect(Array.isArray(result.layers)).toBe(true);
		expect(result.mode).toBeDefined();
		expect(result.budget).toBeDefined();
	});

	test("assembleContext('commit') has budget mode 'focused'", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			mainaDir: tempMainaDir,
		});

		expect(result.mode).toBe("focused");
	});

	test("assembleContext('commit') includes working layer", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			mainaDir: tempMainaDir,
		});

		const workingLayer = result.layers.find((l) => l.name === "working");
		expect(workingLayer).toBeDefined();
		expect(workingLayer?.included).toBe(true);
	});

	test("assembleContext returns tokens count > 0", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			mainaDir: tempMainaDir,
		});

		expect(result.tokens).toBeGreaterThan(0);
	});

	test("assembleContext returns layer reports", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			mainaDir: tempMainaDir,
		});

		expect(result.layers.length).toBeGreaterThan(0);
		for (const layer of result.layers) {
			expect(typeof layer.name).toBe("string");
			expect(typeof layer.tokens).toBe("number");
			expect(typeof layer.entries).toBe("number");
			expect(typeof layer.included).toBe("boolean");
		}
	});

	test("assembled text is non-empty", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			mainaDir: tempMainaDir,
		});

		expect(result.text.length).toBeGreaterThan(0);
	});

	test("working layer is always present in layer reports", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			mainaDir: tempMainaDir,
		});

		const workingLayer = result.layers.find((l) => l.name === "working");
		expect(workingLayer).toBeDefined();
	});

	test("assembleContext('context') includes more layers than 'commit'", async () => {
		const [commitResult, contextResult] = await Promise.all([
			assembleContext("commit", { repoRoot, mainaDir: tempMainaDir }),
			assembleContext("context", { repoRoot, mainaDir: tempMainaDir }),
		]);

		const commitIncluded = commitResult.layers.filter((l) => l.included).length;
		const contextIncluded = contextResult.layers.filter(
			(l) => l.included,
		).length;

		expect(contextIncluded).toBeGreaterThanOrEqual(commitIncluded);
	});

	test("assembleContext('context') has budget mode 'explore'", async () => {
		const result = await assembleContext("context", {
			repoRoot,
			mainaDir: tempMainaDir,
		});

		expect(result.mode).toBe("explore");
	});

	test("assembleContext is resilient — returns valid result even with bad mainaDir", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			mainaDir: join(tmpdir(), "nonexistent-maina-dir-xyz"),
		});

		// Should not throw; should return a valid (possibly minimal) context
		expect(result).toBeDefined();
		expect(typeof result.text).toBe("string");
		expect(typeof result.tokens).toBe("number");
	});

	test("assembleContext with searchQuery includes retrieval layer for 'context' command", async () => {
		const result = await assembleContext("context", {
			repoRoot,
			mainaDir: tempMainaDir,
			searchQuery: "assembleContext",
		});

		const retrievalLayer = result.layers.find((l) => l.name === "retrieval");
		// retrieval layer should be present (included or not depending on results)
		expect(retrievalLayer).toBeDefined();
	});

	test("budget allocation is populated with numeric values", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			mainaDir: tempMainaDir,
		});

		expect(typeof result.budget.working).toBe("number");
		expect(typeof result.budget.episodic).toBe("number");
		expect(typeof result.budget.semantic).toBe("number");
		expect(typeof result.budget.retrieval).toBe("number");
		expect(typeof result.budget.wiki).toBe("number");
		expect(typeof result.budget.total).toBe("number");
		expect(typeof result.budget.headroom).toBe("number");
		expect(result.budget.total).toBeGreaterThan(0);
	});

	test("modelContextWindow option reduces output budget", async () => {
		const fullResult = await assembleContext("commit", {
			repoRoot,
			mainaDir: tempMainaDir,
		});

		const smallResult = await assembleContext("commit", {
			repoRoot,
			mainaDir: tempMainaDir,
			modelContextWindow: 30_000,
		});

		// Smaller context window should produce a smaller budget
		expect(smallResult.budget.total).toBe(30_000);
		expect(smallResult.budget.total).toBeLessThan(fullResult.budget.total);
		expect(smallResult.tokens).toBeLessThanOrEqual(30_000);
	});
});
