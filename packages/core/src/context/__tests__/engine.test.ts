import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeEnv } from "../../ports/testing";
import { assembleContext } from "../engine";

// #390: these tests used to point `repoRoot` at process.cwd(), so every call
// built the semantic layer over the whole maina monorepo (5s timeouts under
// load). A tiny git fixture keeps the engine's behaviour identical while
// bounding the work to a handful of files.

const FIXTURE_BRANCH = "engine-fixture";

let fixtureRoot: string;
let repoRoot: string;
let tempMainaDir: string;

const git = (cwd: string, ...args: string[]): void => {
	const proc = Bun.spawnSync(["git", ...args], {
		cwd,
		env: { ...process.env, LC_ALL: "C" },
	});
	if (proc.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
	}
};

const commitFile = (path: string, content: string, message: string): void => {
	writeFileSync(join(repoRoot, path), content);
	git(repoRoot, "add", path);
	git(repoRoot, "commit", "-q", "-m", message);
};

beforeAll(() => {
	fixtureRoot = mkdtempSync(join(tmpdir(), "maina-engine-test-"));
	repoRoot = join(fixtureRoot, "repo");
	tempMainaDir = join(fixtureRoot, "maina");
	mkdirSync(join(repoRoot, "src"), { recursive: true });
	mkdirSync(join(tempMainaDir, "context"), { recursive: true });

	git(repoRoot, "init", "-q", "-b", FIXTURE_BRANCH);
	git(repoRoot, "config", "user.email", "t@example.com");
	git(repoRoot, "config", "user.name", "t");
	git(repoRoot, "config", "commit.gpgsign", "false");

	// Six commits: enough history for the engine's HEAD~3 / HEAD~5 lookups.
	commitFile(
		"src/math.ts",
		"export function add(a: number, b: number): number {\n\treturn a + b;\n}\n",
		"feat: add",
	);
	commitFile(
		"src/format.ts",
		'import { add } from "./math";\n\nexport function formatSum(a: number, b: number): string {\n\treturn "sum=" + String(add(a, b));\n}\n',
		"feat: formatSum",
	);
	commitFile(
		"src/index.ts",
		'export { add } from "./math";\nexport { formatSum } from "./format";\n',
		"feat: index",
	);
	commitFile(
		"src/assemble.ts",
		'import { formatSum } from "./format";\n\nexport function assembleContext(): string {\n\treturn formatSum(1, 2);\n}\n',
		"feat: assemble",
	);
	commitFile("README.md", "# engine fixture\n", "docs: readme");
	commitFile(
		"src/math.ts",
		"export function add(a: number, b: number): number {\n\treturn b + a;\n}\n",
		"refactor: add",
	);
});

afterAll(() => {
	try {
		rmSync(fixtureRoot, { recursive: true, force: true });
	} catch {
		// ignore cleanup errors
	}
});

describe("assembleContext", () => {
	test("context is assembled from the fixture repo, not the host checkout", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
		});

		expect(result.text).toContain(`Current branch: ${FIXTURE_BRANCH}`);
		expect(result.text).toContain("src/math.ts");
	});

	test("assembleContext('commit') returns an AssembledContext object", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			env: createFakeEnv(),
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
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
		});

		expect(result.mode).toBe("focused");
	});

	test("assembleContext('commit') includes working layer", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
		});

		const workingLayer = result.layers.find((l) => l.name === "working");
		expect(workingLayer).toBeDefined();
		expect(workingLayer?.included).toBe(true);
	});

	test("assembleContext returns tokens count > 0", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
		});

		expect(result.tokens).toBeGreaterThan(0);
	});

	test("assembleContext returns layer reports", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			env: createFakeEnv(),
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
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
		});

		expect(result.text.length).toBeGreaterThan(0);
	});

	test("working layer is always present in layer reports", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
		});

		const workingLayer = result.layers.find((l) => l.name === "working");
		expect(workingLayer).toBeDefined();
	});

	test("assembleContext('context') includes more layers than 'commit'", async () => {
		const [commitResult, contextResult] = await Promise.all([
			assembleContext("commit", {
				repoRoot,
				env: createFakeEnv(),
				mainaDir: tempMainaDir,
			}),
			assembleContext("context", {
				repoRoot,
				env: createFakeEnv(),
				mainaDir: tempMainaDir,
			}),
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
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
		});

		expect(result.mode).toBe("explore");
	});

	test("assembleContext is resilient — returns valid result even with bad mainaDir", async () => {
		const result = await assembleContext("commit", {
			repoRoot,
			env: createFakeEnv(),
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
			env: createFakeEnv(),
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
			env: createFakeEnv(),
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
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
		});

		const smallResult = await assembleContext("commit", {
			repoRoot,
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
			modelContextWindow: 30_000,
		});

		// Smaller context window should produce a smaller budget
		expect(smallResult.budget.total).toBe(30_000);
		expect(smallResult.budget.total).toBeLessThan(fullResult.budget.total);
		expect(smallResult.tokens).toBeLessThanOrEqual(30_000);
	});
});
