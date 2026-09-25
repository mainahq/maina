/**
 * The runtime's gate evaluators (FR-GATE-1, FR-GATE-3): the wire event is
 * normalised into a core `GateEvent` and run through `evaluateGate`, both in
 * the daemon and in the hook client's rules-only fallback. Every path that
 * cannot evaluate (no working directory, no repository, a bad policy, a
 * malformed event, a failing port) asks.
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDecisionDb } from "@mainahq/cli/src/decision-store";
import {
	type Backend,
	createRegistry,
	type DbPort,
	DEFAULT_POLICY,
	DEFAULT_REGISTRY,
	type DecisionRecord,
	evaluateGate,
	type GateContext,
	hashInput,
	LOG_SALT_PATH,
	loadShellParser,
	migrateDecisionLog,
	type Policy,
	queryDecisions,
	toDbPort,
} from "@mainahq/core";
import { createHookClient } from "../client/hook-client";
import {
	createGateEvaluator,
	type GateDecision,
	type GateEvaluatorDeps,
	type GateEvent,
	parseGateDecision,
	toCoreGateEvent,
} from "../gate";
import { systemGates } from "../gate-system";
import { noSpawn, tempEndpoint } from "./support";

const ROOT = "/work/repo";
let ctx: GateContext;

beforeAll(async () => {
	const shell = await loadShellParser();
	if (!shell.ok) throw new Error(shell.error.message);
	ctx = { shell: shell.value, home: "/home/dev" };
});

function deps(overrides: Partial<GateEvaluatorDeps> = {}): GateEvaluatorDeps {
	let n = 0;
	return {
		rootOf: () => ROOT,
		policyFor: async () => ({ ok: true, value: DEFAULT_POLICY }),
		context: async () => ctx,
		clock: { now: () => 0 },
		newId: () => `id-${++n}`,
		...overrides,
	};
}

const shell = (command: string, cwd: string | null = ROOT): GateEvent =>
	cwd === null
		? { kind: "shell", input: { command } }
		: { kind: "shell", input: { command }, cwd };

const withDeny = (match: string): Policy => ({
	...DEFAULT_POLICY,
	rules: { allow: [], deny: [{ match }] },
});

/** A model stand-in that denies everything. */
const denyAll: Backend = {
	id: "system1",
	version: "test",
	answer: ({ questions }) => ({
		ok: true,
		value: questions.map(() => ({
			answer: "deny",
			distribution: [
				{ answer: "allow", p: 0 },
				{ answer: "ask", p: 0 },
				{ answer: "deny", p: 1 },
			],
		})),
	}),
};

/** A model stand-in that never answers, so core's gate degrades. */
const unavailable: Backend = {
	id: "system1",
	version: "test",
	answer: () => ({
		ok: false,
		error: { kind: "unsupported", questionId: undefined, message: "no model" },
	}),
};

const modelPolicy: Policy = {
	...DEFAULT_POLICY,
	decisions: {
		...DEFAULT_POLICY.decisions,
		"action.risk": {
			...DEFAULT_POLICY.decisions["action.risk"],
			backend: "system1",
		},
	},
};

describe("toCoreGateEvent", () => {
	test("maps each wire kind onto the core event", () => {
		expect(toCoreGateEvent(shell("ls", "/work/repo/src"), ROOT)).toEqual({
			kind: "shell",
			action: { command: "ls", cwd: "/work/repo/src" },
			host: "unknown",
			sessionId: "",
			root: ROOT,
			permissionMode: "unknown",
			untrusted: [],
		});
		expect(
			toCoreGateEvent(
				{
					kind: "file.write",
					input: { file_path: "src/a.ts", content: "x" },
					cwd: ROOT,
				},
				ROOT,
			),
		).toMatchObject({
			kind: "file.write",
			action: { path: "/work/repo/src/a.ts", content: "x" },
		});
		expect(
			toCoreGateEvent(
				{ kind: "file.read.outside", input: { path: "/etc/hosts" } },
				ROOT,
			),
		).toMatchObject({
			kind: "file.read.outside",
			action: { path: "/etc/hosts" },
		});
		expect(
			toCoreGateEvent(
				{
					kind: "mcp",
					input: { server: "gh", tool: "merge", arguments: { pr: 1 } },
				},
				ROOT,
			),
		).toMatchObject({
			kind: "mcp",
			action: { server: "gh", tool: "merge", input: { pr: 1 } },
		});
		expect(
			toCoreGateEvent(
				{ kind: "network", input: { url: "https://x.dev", method: "POST" } },
				ROOT,
			),
		).toMatchObject({
			kind: "network",
			action: { url: "https://x.dev", method: "POST" },
		});
	});

	test("a relative file path resolves against the event's cwd, not the root", () => {
		const write = (path: string, cwd?: string): GateEvent =>
			cwd === undefined
				? { kind: "file.write", input: { path } }
				: { kind: "file.write", input: { path }, cwd };
		expect(
			toCoreGateEvent(write("../x.ts", "/work/repo/src"), ROOT)?.action,
		).toEqual({ path: "/work/repo/x.ts" });
		expect(
			toCoreGateEvent(
				{
					kind: "file.read.outside",
					input: { file_path: "../../etc/hosts" },
					cwd: "/work/repo",
				},
				ROOT,
			)?.action,
		).toEqual({ path: "/etc/hosts" });
		// Absolute and home-relative paths are left for core to resolve.
		expect(toCoreGateEvent(write("/abs/a", ROOT), ROOT)?.action).toEqual({
			path: "/abs/a",
		});
		for (const home of ["~", "~/a", "$HOME/a", "${HOME}/a"]) {
			expect(toCoreGateEvent(write(home, ROOT), ROOT)?.action).toEqual({
				path: home,
			});
		}
		expect(toCoreGateEvent(write("a.ts"), ROOT)?.action).toEqual({
			path: "a.ts",
		});
	});

	test("carries host metadata, dropping values of the wrong type", () => {
		const event = toCoreGateEvent(
			{
				kind: "shell",
				input: {
					command: "ls",
					host: "claude-code",
					sessionId: "s1",
					permissionMode: "bypass",
					untrusted: ["web:https://x", 42],
				},
			},
			ROOT,
		);
		expect(event).toMatchObject({
			host: "claude-code",
			sessionId: "s1",
			permissionMode: "bypass",
			untrusted: ["web:https://x"],
		});
		const odd = toCoreGateEvent(
			{ kind: "shell", input: { command: "ls", permissionMode: "yolo" } },
			ROOT,
		);
		expect(odd?.permissionMode).toBe("unknown");
	});

	test.each([
		{ kind: "shell", input: {} },
		{ kind: "shell", input: { command: 42 } },
		{ kind: "file.write", input: { content: "x" } },
		{ kind: "mcp", input: { server: "gh" } },
		{ kind: "network", input: {} },
		{ kind: "teleport", input: { command: "ls" } },
	] as GateEvent[])("a malformed event is null: %j", (event) => {
		expect(toCoreGateEvent(event, ROOT)).toBeNull();
	});
});

describe("createGateEvaluator", () => {
	test("a harmless command is allowed", async () => {
		const gate = createGateEvaluator(deps());
		expect((await gate(shell("ls -la"))).verdict).toBe("allow");
	});

	test("an irreversible command asks", async () => {
		const gate = createGateEvaluator(deps());
		const decision = await gate(shell("rm -rf /"));
		expect(decision.verdict).toBe("ask");
		expect(decision.reason).toContain("irreversible");
	});

	test("a relative write from a subdirectory that lands outside the repo asks", async () => {
		// From /work/repo/sub, ../../work/repo/x is /work/work/repo/x: outside.
		// Read against the root it would be /work/repo/x, inside, and allowed.
		const gate = createGateEvaluator(deps());
		const decision = await gate({
			kind: "file.write",
			input: { file_path: "../../work/repo/x", content: "x" },
			cwd: "/work/repo/sub",
		});
		expect(decision.verdict).toBe("ask");
		expect(decision.reason).toContain("fs.write.outside");
	});

	test("the policy for the event's root applies", async () => {
		const seen: string[] = [];
		const gate = createGateEvaluator(
			deps({
				rootOf: (cwd) => `${cwd}/..`,
				policyFor: async (root) => {
					seen.push(root);
					return { ok: true, value: withDeny("git status") };
				},
			}),
		);
		expect((await gate(shell("git status", "/w/r/sub"))).verdict).toBe("deny");
		expect(seen).toEqual(["/w/r/sub/.."]);
	});

	test("full mode consults the policy's model backend", async () => {
		const gate = createGateEvaluator(
			deps({
				backends: createRegistry([...DEFAULT_REGISTRY.values(), denyAll]),
				policyFor: async () => ({ ok: true, value: modelPolicy }),
			}),
		);
		expect((await gate(shell("ls -la"))).verdict).toBe("deny");
	});

	test("rules-only mode never consults a model backend", async () => {
		const gate = createGateEvaluator(
			deps({
				backends: createRegistry([...DEFAULT_REGISTRY.values(), denyAll]),
				policyFor: async () => ({ ok: true, value: modelPolicy }),
			}),
			"rules_only",
		);
		expect((await gate(shell("ls -la"))).verdict).toBe("allow");
	});

	test.each([
		["no working directory", deps(), shell("ls", null)],
		["no repository", deps({ rootOf: () => null }), shell("ls")],
		[
			"an invalid policy",
			deps({
				policyFor: async () => ({ ok: false, error: [{ message: "bad" }] }),
			}),
			shell("ls"),
		],
		[
			"a failing port",
			deps({ context: () => Promise.reject(new Error("boom")) }),
			shell("ls"),
		],
		["a malformed event", deps(), { kind: "shell", input: {}, cwd: ROOT }],
	] as const)("%s asks, degraded and with no decision ids", async (_label, d, event) => {
		const decision = await createGateEvaluator(d)(event);
		expect(decision).toMatchObject({
			verdict: "ask",
			decisionIds: [],
			degraded: true,
		});
	});

	// #454: the wire decision carries core's `degraded` and `decisionIds`.
	test("a rules-only verdict carries its decision ids, not degraded", async () => {
		const decision = await createGateEvaluator(
			deps(),
			"rules_only",
		)(shell("ls -la"));
		expect(decision).toMatchObject({
			verdict: "allow",
			decisionIds: ["id-1"],
			degraded: false,
		});
	});

	test("a model verdict carries its decision ids, not degraded", async () => {
		const gate = createGateEvaluator(
			deps({
				backends: createRegistry([...DEFAULT_REGISTRY.values(), denyAll]),
				policyFor: async () => ({ ok: true, value: modelPolicy }),
			}),
		);
		const decision = await gate(shell("ls -la"));
		expect(decision.verdict).toBe("deny");
		expect(decision.degraded).toBe(false);
		expect(decision.decisionIds.length).toBeGreaterThan(0);
	});

	test("a model that cannot answer makes the decision degraded", async () => {
		const gate = createGateEvaluator(
			deps({
				backends: createRegistry([...DEFAULT_REGISTRY.values(), unavailable]),
				policyFor: async () => ({ ok: true, value: modelPolicy }),
			}),
		);
		const decision = await gate(shell("ls -la"));
		expect(decision.degraded).toBe(true);
		expect(decision.verdict).not.toBe("allow");
	});

	test("no shell grammar makes a shell decision degraded", async () => {
		const gate = createGateEvaluator(
			deps({ context: async () => ({ shell: null, home: "/home/dev" }) }),
		);
		expect(await gate(shell("ls -la"))).toMatchObject({
			verdict: "ask",
			degraded: true,
		});
	});
});

// #452: gate decisions are logged with the repo's salt (FR-DEC-5).
describe("decision log", () => {
	const SALT_A = "a".repeat(64);
	const SALT_B = "b".repeat(64);

	function memoryDb(): DbPort {
		const db = toDbPort(new Database(":memory:"));
		const migrated = migrateDecisionLog(db);
		if (!migrated.ok) throw new Error(migrated.error.message);
		return db;
	}

	function logged(db: DbPort): readonly DecisionRecord[] {
		const records = queryDecisions({ db });
		if (!records.ok) throw new Error(records.error.message);
		return records.value;
	}

	async function logWith(
		salt: string,
		event: GateEvent = shell("ls -la"),
	): Promise<Readonly<{ decision: GateDecision; db: DbPort }>> {
		const db = memoryDb();
		const gate = createGateEvaluator(
			deps({
				logFor: async () => ({ ok: true, value: { db, salt, now: () => 42 } }),
			}),
		);
		return { decision: await gate(event), db };
	}

	test("every action.risk decision is logged under its id", async () => {
		const { decision, db } = await logWith(SALT_A);
		const records = logged(db);
		expect(decision.decisionIds.length).toBe(1);
		expect(records.map((r) => r.id)).toEqual([...decision.decisionIds]);
		expect(records[0]).toMatchObject({
			type: "action.risk",
			ts: 42,
			answer: "allow",
			finalAction: "allow",
		});
	});

	test("the same path gets different hashes under two repos' salts", async () => {
		const event: GateEvent = {
			kind: "file.write",
			input: { file_path: "src/secret-plan.ts", content: "x" },
			cwd: ROOT,
		};
		const [a] = logged((await logWith(SALT_A, event)).db);
		const [again] = logged((await logWith(SALT_A, event)).db);
		const [b] = logged((await logWith(SALT_B, event)).db);
		expect(a?.inputHash).toBe(again?.inputHash as string);
		expect(a?.inputHash).not.toBe(b?.inputHash as string);
		expect(a?.schemaHash).not.toBe(b?.schemaHash as string);
	});

	test("a verdict decided by a rule alone logs nothing", async () => {
		const db = memoryDb();
		const decision = await createGateEvaluator(
			deps({
				policyFor: async () => ({ ok: true, value: withDeny("git status") }),
				logFor: async () => ({
					ok: true,
					value: { db, salt: SALT_A, now: () => 1 },
				}),
			}),
		)(shell("git status"));
		expect(decision.verdict).toBe("deny");
		expect(logged(db)).toEqual([]);
	});

	const failingLogs: ReadonlyArray<
		readonly [string, NonNullable<GateEvaluatorDeps["logFor"]>]
	> = [
		["an unloadable salt", async () => ({ ok: false, error: "bad salt" })],
		["a failing log port", () => Promise.reject(new Error("boom"))],
	];
	test.each(
		failingLogs,
	)("%s never changes the verdict", async (_label, logFor) => {
		const decision = await createGateEvaluator(deps({ logFor }))(
			shell("ls -la"),
		);
		expect(decision).toMatchObject({ verdict: "allow", degraded: false });
	});

	test("a failing append never changes the verdict", async () => {
		const db: DbPort = {
			run: () => ({
				ok: false,
				error: { kind: "query_failed", message: "locked" },
			}),
			all: () => ({ ok: true, value: [] }),
		};
		const decision = await createGateEvaluator(
			deps({
				logFor: async () => ({
					ok: true,
					value: { db, salt: SALT_A, now: () => 1 },
				}),
			}),
		)(shell("ls -la"));
		expect(decision).toMatchObject({ verdict: "allow", degraded: false });
	});
});

describe("parseGateDecision", () => {
	test("accepts a full decision", () => {
		const decision: GateDecision = {
			verdict: "ask",
			reason: "r",
			decisionIds: ["a"],
			degraded: true,
		};
		expect(parseGateDecision(decision)).toEqual(decision);
	});

	test.each([
		["no degraded flag", { verdict: "allow", reason: "r", decisionIds: [] }],
		[
			"a non-boolean degraded flag",
			{ verdict: "allow", reason: "r", decisionIds: [], degraded: "no" },
		],
		["no decision ids", { verdict: "allow", reason: "r", degraded: false }],
		[
			"a non-string decision id",
			{ verdict: "allow", reason: "r", decisionIds: [1], degraded: false },
		],
	] as const)("rejects %s", (_label, value) => {
		expect(parseGateDecision(value)).toBeNull();
	});
});

describe("hook client rules-only fallback", () => {
	test("with no runtime the client returns the rules' verdict, degraded and never allow", async () => {
		const temp = tempEndpoint();
		try {
			const client = createHookClient({
				endpoint: temp.endpoint,
				version: "1.0.0",
				spawn: noSpawn,
				fallback: createGateEvaluator(
					deps({
						policyFor: async () => ({
							ok: true,
							value: withDeny("git status"),
						}),
					}),
					"rules_only",
				),
			});
			const denied = await client.evaluate(shell("git status"), {
				timeoutMs: 200,
			});
			expect(denied).toMatchObject({ verdict: "deny", degraded: true });
			const irreversible = await client.evaluate(shell("rm -rf /"), {
				timeoutMs: 200,
			});
			expect(irreversible).toMatchObject({ verdict: "ask", degraded: true });
			const harmless = await client.evaluate(shell("ls"), { timeoutMs: 200 });
			// The fallback keeps the rules' decision ids for the log.
			expect(harmless).toMatchObject({
				verdict: "ask",
				decisionIds: [expect.any(String)],
				degraded: true,
				source: "fallback",
			});
		} finally {
			temp.cleanup();
		}
	});
});

describe("systemGates", () => {
	let repo = "";
	beforeAll(() => {
		repo = mkdtempSync(join(tmpdir(), "maina-gate-"));
		Bun.spawnSync(["git", "init", "-q", repo]);
	});
	afterAll(() => rmSync(repo, { recursive: true, force: true }));

	test("evaluates against the repository the event runs in", async () => {
		const gates = systemGates();
		expect((await gates.runtime(shell("ls -la", repo))).verdict).toBe("allow");
		expect((await gates.runtime(shell("rm -rf /", repo))).verdict).toBe("ask");
		expect((await gates.fallback(shell("rm -rf /", repo))).verdict).toBe("ask");
	});

	test("reads the repo policy", async () => {
		const dir = join(repo, ".maina");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "policy.json"),
			JSON.stringify({ rules: { deny: [{ match: "git status" }] } }),
		);
		const gates = systemGates();
		expect((await gates.runtime(shell("git status", repo))).verdict).toBe(
			"deny",
		);
	});

	test("reads the user policy, so `maina allow --always` takes effect (FR-GATE-8)", async () => {
		const home = mkdtempSync(join(tmpdir(), "maina-gate-home-"));
		try {
			const push = shell("git push origin main", repo);
			expect((await systemGates({ home }).runtime(push)).verdict).toBe("ask");
			mkdirSync(join(home, ".maina"), { recursive: true });
			writeFileSync(
				join(home, ".maina", "policy.json"),
				JSON.stringify({
					rules: { allow: [{ match: "git push origin main", kind: "shell" }] },
				}),
			);
			expect((await systemGates({ home }).runtime(push)).verdict).toBe("allow");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	// #452: real gate decisions go to `.maina/decisions.db`, keyed by the
	// repo's own salt (`.maina/private/log-salt`), loaded once per root.
	describe("decision log", () => {
		const repos: string[] = [];
		const home = mkdtempSync(join(tmpdir(), "maina-gate-home-"));
		afterAll(() => {
			for (const r of [...repos, home]) {
				rmSync(r, { recursive: true, force: true });
			}
		});

		function newRepo(withMaina = true): string {
			// The real path: the gate keys state by the resolved root.
			const dir = realpathSync(mkdtempSync(join(tmpdir(), "maina-gate-log-")));
			Bun.spawnSync(["git", "init", "-q", dir]);
			if (withMaina) mkdirSync(join(dir, ".maina"));
			repos.push(dir);
			return dir;
		}

		function records(root: string): readonly DecisionRecord[] {
			const opened = openDecisionDb(join(root, ".maina"));
			if (!opened.ok) throw new Error(opened.error);
			try {
				const found = queryDecisions(opened.value, { newestFirst: false });
				if (!found.ok) throw new Error(found.error.message);
				return found.value;
			} finally {
				opened.value.close();
			}
		}

		const saltOf = (root: string): string =>
			readFileSync(join(root, LOG_SALT_PATH), "utf8").trim();

		/** The `action.risk` state core builds for `event` under `root`. */
		function riskState(event: GateEvent, root: string) {
			const core = toCoreGateEvent(event, root);
			if (core === null) throw new Error("no core event");
			const result = evaluateGate(
				{
					clock: { now: () => 0 },
					backends: DEFAULT_REGISTRY,
					ctx,
					newId: () => "probe",
				},
				core,
				DEFAULT_POLICY,
			);
			const state = result.decided?.answers[0]?.request.state;
			if (state === undefined) throw new Error("no action.risk request");
			return state;
		}

		const write = (root: string): GateEvent => ({
			kind: "file.write",
			input: { file_path: "src/plan.ts", content: "x" },
			cwd: root,
		});

		test("records are keyed by the repo's salt, and two repos differ", async () => {
			const a = newRepo();
			const b = newRepo();
			const gates = systemGates({ home });
			const decided = await gates.runtime(write(a));
			await gates.runtime(write(b));
			const [ra] = records(a);
			const [rb] = records(b);
			expect(ra?.id).toBe(decided.decisionIds[0] as string);
			expect(saltOf(a)).not.toBe(saltOf(b));
			const state = riskState(write(a), a);
			const id = ra?.id as string;
			expect(ra?.inputHash).toBe(
				hashInput("action.risk", state, id, saltOf(a)),
			);
			expect(ra?.inputHash).not.toBe(hashInput("action.risk", state, id));
			expect(rb?.inputHash).toBe(
				hashInput(
					"action.risk",
					riskState(write(b), b),
					rb?.id as string,
					saltOf(b),
				),
			);
		});

		test("the salt is loaded once per root", async () => {
			const repo = newRepo();
			const gates = systemGates({ home });
			await gates.runtime(write(repo));
			const salt = saltOf(repo);
			rmSync(join(repo, LOG_SALT_PATH));
			await gates.runtime(write(repo));
			expect(existsSync(join(repo, LOG_SALT_PATH))).toBe(false);
			const second = records(repo)[1];
			expect(second?.inputHash).toBe(
				hashInput(
					"action.risk",
					riskState(write(repo), repo),
					second?.id as string,
					salt,
				),
			);
		});

		test("concurrent first events share one salt and one store", async () => {
			const repo = newRepo();
			const gates = systemGates({ home });
			const decided = await Promise.all(
				Array.from({ length: 8 }, () => gates.runtime(write(repo))),
			);
			const salt = saltOf(repo);
			const state = riskState(write(repo), repo);
			const logged = records(repo);
			expect(logged.map((r) => r.id).sort()).toEqual(
				decided.flatMap((d) => [...d.decisionIds]).sort(),
			);
			for (const r of logged) {
				expect(r.inputHash).toBe(hashInput("action.risk", state, r.id, salt));
			}
		});

		test("a repo without .maina is not written to", async () => {
			const repo = newRepo(false);
			const decided = await systemGates({ home }).runtime(write(repo));
			expect(decided.verdict).toBe("allow");
			expect(existsSync(join(repo, ".maina"))).toBe(false);
		});

		test("a malformed salt logs nothing and keeps the verdict", async () => {
			const repo = newRepo();
			mkdirSync(join(repo, ".maina", "private"));
			writeFileSync(join(repo, LOG_SALT_PATH), "not-a-salt\n");
			const decided = await systemGates({ home }).runtime(write(repo));
			expect(decided.verdict).toBe("allow");
			expect(records(repo)).toEqual([]);
			expect(saltOf(repo)).toBe("not-a-salt");
		});
	});

	test("an invalid user policy asks instead of being ignored", async () => {
		const home = mkdtempSync(join(tmpdir(), "maina-gate-home-"));
		try {
			mkdirSync(join(home, ".maina"), { recursive: true });
			writeFileSync(join(home, ".maina", "policy.json"), "{ nope");
			const result = await systemGates({ home }).runtime(shell("ls", repo));
			expect(result.verdict).toBe("ask");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
