import {
	afterAll,
	beforeAll,
	describe,
	expect,
	setDefaultTimeout,
	test,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProcessGit } from "../../git/index";
import { systemFs } from "../../graph/system";
import { createFakeEnv, createMemoryDb } from "../../ports/testing";
import { systemProcess } from "../../process/index";
import { assembleContext } from "../engine";

// #390: these tests used to point `repoRoot` at process.cwd(), so every call
// built the semantic layer over the whole maina monorepo (5s timeouts under
// load). A tiny git fixture keeps the engine's behaviour identical while
// bounding the work to a handful of files.
//
// The engine still spawns real git (and tree-sitter/ripgrep) against that
// fixture, and the fixture build itself runs ~25 git commands, so the suite
// declares an explicit timeout for CI and parallel local load (#434).
setDefaultTimeout(30_000);

const FIXTURE_BRANCH = "engine-fixture";

let fixtureRoot: string;
let repoRoot: string;
let tempMainaDir: string;

// Drop inherited GIT_* variables (git exports GIT_DIR / GIT_INDEX_FILE to
// hooks). If the suite runs from a hook, a leaked GIT_DIR would point
// `git init` / `git commit` at the host repository and commit fixture files
// onto the developer's branch.
const fixtureGitEnv = (): Record<string, string> => {
	const env: Record<string, string> = { LC_ALL: "C" };
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !key.startsWith("GIT_") && key !== "LC_ALL") {
			env[key] = value;
		}
	}
	return env;
};

const git = (cwd: string, ...args: string[]): void => {
	const proc = Bun.spawnSync(["git", ...args], {
		cwd,
		env: fixtureGitEnv(),
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

	test("assembleContext('review') returns graph-derived semantic context", async () => {
		const result = await assembleContext("review", {
			repoRoot,
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
		});

		const semantic = result.layers.find((l) => l.name === "semantic");
		expect(semantic?.included).toBe(true);
		expect(semantic?.tokens ?? 0).toBeGreaterThan(50);
		expect(result.text).toContain("## Code Graph");
		// A snippet of a touched file, read through the graph's line ranges.
		expect(result.text).toContain("export function formatSum(");
	});

	test("no full-repo walk per call: the graph is listed once, then synced by path", async () => {
		const git = createProcessGit(systemProcess);
		const gitCalls: string[] = [];
		const listings: string[] = [];
		const graph = {
			db: createMemoryDb(),
			git: {
				run: (root: string, args: readonly string[]) => {
					gitCalls.push(args.join(" "));
					return git.run(root, args);
				},
			},
			fs: {
				...systemFs,
				readDir: (path: string) => {
					listings.push(path);
					return systemFs.readDir(path);
				},
			},
		};
		const lsFiles = () => gitCalls.filter((c) => c.startsWith("ls-files"));

		const first = await assembleContext("review", {
			repoRoot,
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
			graph,
		});
		expect(first.text).toContain("## Code Graph");
		expect(lsFiles()).toHaveLength(1);

		listings.length = 0;
		const second = await assembleContext("review", {
			repoRoot,
			env: createFakeEnv(),
			mainaDir: tempMainaDir,
			graph,
		});
		expect(second.text).toContain("## Code Graph");
		expect(lsFiles()).toHaveLength(1);
		expect(listings).toEqual([]);
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

// #439: the episodic layer merged team entries from maina cloud with the
// client's default 10s timeout and 3 retries, so a slow or unreachable cloud
// held every `review` / `verify` context call for ~43s. The merge is now
// bounded, cached under `mainaDir`, and skipped when not logged in.
describe("assembleContext cloud episodic merge (#439)", () => {
	type FakeCloud = Readonly<{
		url: string;
		connections: () => number;
		stop: () => void;
	}>;

	/** A TCP port that accepts connections and never answers. */
	const hangingCloud = (): FakeCloud => {
		let connections = 0;
		const listener = Bun.listen({
			hostname: "127.0.0.1",
			port: 0,
			socket: {
				open: () => {
					connections++;
				},
				data: () => undefined,
			},
		});
		return {
			url: `http://127.0.0.1:${listener.port}`,
			connections: () => connections,
			stop: () => listener.stop(true),
		};
	};

	/** A cloud that answers `/context/episodic` with one team entry. */
	const answeringCloud = (): FakeCloud => {
		let connections = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => {
				connections++;
				return Response.json({
					data: {
						entries: [
							{
								id: "cloud-1",
								repo: "acme/app",
								entry_type: "review",
								title: "Team review from the cloud",
								summary: "cloud-only-episodic-marker",
								relevance_score: 1,
								decay_factor: 1,
								created_at: "2026-09-01T00:00:00.000Z",
								accessed_at: "2026-09-01T00:00:00.000Z",
							},
						],
					},
				});
			},
		});
		return {
			url: `http://127.0.0.1:${server.port}`,
			connections: () => connections,
			stop: () => server.stop(true),
		};
	};

	const loggedInAuthDir = (): string => {
		const dir = mkdtempSync(join(fixtureRoot, "auth-"));
		writeFileSync(
			join(dir, "auth.json"),
			JSON.stringify({ accessToken: "test-token" }),
		);
		return dir;
	};

	const freshMainaDir = (): string => {
		const dir = mkdtempSync(join(fixtureRoot, "maina-"));
		mkdirSync(join(dir, "context"), { recursive: true });
		return dir;
	};

	test("a hanging cloud bounds the review context to the cloud timeout", async () => {
		const cloud = hangingCloud();
		try {
			const started = performance.now();
			const result = await assembleContext("review", {
				repoRoot,
				env: createFakeEnv({ MAINA_CLOUD_URL: cloud.url }),
				mainaDir: freshMainaDir(),
				authDir: loggedInAuthDir(),
			});
			const elapsed = performance.now() - started;

			expect(cloud.connections()).toBe(1);
			expect(elapsed).toBeLessThan(4_000);
			expect(result.layers.some((l) => l.name === "episodic")).toBe(true);
		} finally {
			cloud.stop();
		}
	});

	test("a failed cloud fetch is cached, so the next call does not wait again", async () => {
		const cloud = hangingCloud();
		const mainaDir = freshMainaDir();
		const authDir = loggedInAuthDir();
		const env = createFakeEnv({ MAINA_CLOUD_URL: cloud.url });
		try {
			await assembleContext("verify", { repoRoot, env, mainaDir, authDir });
			expect(cloud.connections()).toBe(1);

			await assembleContext("verify", { repoRoot, env, mainaDir, authDir });
			expect(cloud.connections()).toBe(1);
		} finally {
			cloud.stop();
		}
	});

	test("team entries are merged and served from cache on the next call", async () => {
		const cloud = answeringCloud();
		const mainaDir = freshMainaDir();
		const authDir = loggedInAuthDir();
		const env = createFakeEnv({ MAINA_CLOUD_URL: cloud.url });
		try {
			const first = await assembleContext("review", {
				repoRoot,
				env,
				mainaDir,
				authDir,
			});
			expect(first.text).toContain("cloud-only-episodic-marker");
			expect(cloud.connections()).toBe(1);

			const second = await assembleContext("review", {
				repoRoot,
				env,
				mainaDir,
				authDir,
			});
			expect(second.text).toContain("cloud-only-episodic-marker");
			expect(cloud.connections()).toBe(1);
		} finally {
			cloud.stop();
		}
	});

	test("the cloud is never contacted when not logged in", async () => {
		const cloud = hangingCloud();
		try {
			await assembleContext("review", {
				repoRoot,
				env: createFakeEnv({ MAINA_CLOUD_URL: cloud.url }),
				mainaDir: freshMainaDir(),
				authDir: mkdtempSync(join(fixtureRoot, "no-auth-")),
			});
			expect(cloud.connections()).toBe(0);
		} finally {
			cloud.stop();
		}
	});
});
