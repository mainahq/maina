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
	findGateSubject,
	type GateContext,
	hashInput,
	LOG_SALT_PATH,
	loadShellParser,
	migrateDecisionLog,
	migrateGateSubjects,
	type Policy,
	queryDecisions,
	recordOverride,
	scopedAllowRules,
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
import { branchCache, systemGates } from "../gate-system";
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

	test("a bare push resolves against the branch checked out in the event's root (#459)", async () => {
		const seen: string[] = [];
		const on = (branch: string | null) =>
			createGateEvaluator(
				deps({
					rootOf: (cwd) => `${cwd}/..`,
					branchOf: async (root) => {
						seen.push(root);
						return { ok: true, value: branch };
					},
				}),
			);
		expect((await on("master")(shell("git push", "/w/r/sub"))).verdict).toBe(
			"ask",
		);
		expect(
			(await on("master")(shell("git push -u origin HEAD", "/w/r/sub")))
				.verdict,
		).toBe("ask");
		expect((await on("feature")(shell("git push", "/w/r/sub"))).verdict).toBe(
			"allow",
		);
		expect((await on(null)(shell("git push", "/w/r/sub"))).verdict).toBe(
			"allow",
		);
		expect(seen).toEqual([
			"/w/r/sub/..",
			"/w/r/sub/..",
			"/w/r/sub/..",
			"/w/r/sub/..",
		]);
	});

	test("the branch is looked up only for shell events (#459)", async () => {
		let lookups = 0;
		const gate = createGateEvaluator(
			deps({
				branchOf: async () => {
					lookups++;
					return { ok: true, value: "main" };
				},
			}),
		);
		await gate({
			kind: "file.write",
			input: { file_path: "src/a.ts", content: "x" },
			cwd: ROOT,
		});
		expect(lookups).toBe(0);
	});

	test("a failing branch lookup asks (#459)", async () => {
		const gate = createGateEvaluator(
			deps({ branchOf: () => Promise.reject(new Error("git gone")) }),
		);
		const decision = await gate(shell("git push"));
		expect(decision.verdict).toBe("ask");
		expect(decision.degraded).toBe(true);
	});

	test("a branch lookup that returns an error asks, never allows (#459)", async () => {
		const gate = createGateEvaluator(
			deps({
				branchOf: async () => ({
					ok: false,
					error: { kind: "git_failed", exitCode: 128 },
				}),
			}),
		);
		const decision = await gate(shell("git push"));
		expect(decision.verdict).toBe("ask");
		expect(decision.degraded).toBe(true);
		expect(decision.reason).toContain("checked-out branch");
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
		const subjects = migrateGateSubjects(db);
		if (!subjects.ok) throw new Error(subjects.error.message);
		return db;
	}

	function subjectOf(db: DbPort, id: string) {
		const found = findGateSubject(db, id);
		if (!found.ok) throw new Error(found.error.kind);
		return found.value;
	}

	function gateWithLog(
		db: DbPort,
		overrides: Partial<GateEvaluatorDeps> = {},
		mode: "full" | "rules_only" = "full",
	) {
		return createGateEvaluator(
			deps({
				logFor: async () => ({
					ok: true,
					value: { db, salt: SALT_A, now: () => 1 },
				}),
				...overrides,
			}),
			mode,
		);
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

	// #448: every ask or deny is logged with its subject under
	// `decisionIds[0]`, so `maina allow <id> [--always]` resolves.
	test.each([
		"full",
		"rules_only",
	] as const)("a rule's own deny is logged with its subject (%s)", async (mode) => {
		const db = memoryDb();
		const decision = await gateWithLog(
			db,
			{ policyFor: async () => ({ ok: true, value: withDeny("git status") }) },
			mode,
		)(shell("git status"));
		expect(decision.verdict).toBe("deny");
		expect(decision.decisionIds).toEqual(["id-1"]);
		expect(logged(db)).toMatchObject([
			{ id: "id-1", answer: "deny", finalAction: "deny" },
		]);
		expect(subjectOf(db, "id-1")).toEqual({
			decisionId: "id-1",
			kind: "shell",
			targets: ["git status"],
			classes: ["shell.exec"],
			rule: "deny",
			irreversible: false,
		});
	});

	test("a rule's own ask is logged with its subject", async () => {
		const db = memoryDb();
		const decision = await gateWithLog(db)(shell("git push origin main"));
		expect(decision.verdict).toBe("ask");
		const [id] = decision.decisionIds;
		expect(logged(db).map((r) => r.id)).toEqual([id as string]);
		expect(subjectOf(db, id as string)).toMatchObject({
			kind: "shell",
			targets: ["git push origin main"],
			rule: "ask",
		});
	});

	test("a model's two-order ask records one subject, under the first id", async () => {
		const db = memoryDb();
		// Answers in each question's own option order, so both orders agree.
		const denyEach: Backend = {
			id: "system1",
			version: "test",
			answer: ({ questions }) => ({
				ok: true,
				value: questions.map((q) => ({
					answer: "deny",
					distribution: (q.kind === "choice" ? q.options : []).map((o) => ({
						answer: o,
						p: o === "deny" ? 1 : 0,
					})),
				})),
			}),
		};
		const decision = await gateWithLog(db, {
			backends: createRegistry([...DEFAULT_REGISTRY.values(), denyEach]),
			policyFor: async () => ({ ok: true, value: modelPolicy }),
		})({
			kind: "shell",
			input: { command: "ls -la", untrusted: ["web"] },
			cwd: ROOT,
		});
		expect(decision.verdict).toBe("deny");
		const [first, second] = decision.decisionIds;
		expect(decision.decisionIds.length).toBe(2);
		expect(subjectOf(db, first as string)?.targets).toEqual(["ls -la"]);
		expect(subjectOf(db, second as string)).toBeUndefined();
	});

	// #480: every evaluation is appended, so the session summary, `maina
	// allow`, the dogfood report and drift see what the gate did.
	test("an allow rule's allow is logged with the session it came from", async () => {
		const db = memoryDb();
		const decision = await gateWithLog(db, {
			policyFor: async () => ({
				ok: true,
				value: {
					...DEFAULT_POLICY,
					rules: { allow: [{ match: "git push" }], deny: [] },
				},
			}),
		})({
			kind: "shell",
			input: {
				command: "git push origin main",
				host: "claude-code",
				sessionId: "s-480",
			},
			cwd: ROOT,
		});
		expect(decision.verdict).toBe("allow");
		expect(logged(db)).toMatchObject([
			{
				id: decision.decisionIds[0] as string,
				answer: "allow",
				finalAction: "allow",
				host: "claude-code",
				sessionId: "s-480",
			},
		]);
		expect(subjectOf(db, decision.decisionIds[0] as string)).toBeUndefined();
	});

	test("the rules-only fallback logs an allow as the ask the client turns it into", async () => {
		const db = memoryDb();
		const decision = await gateWithLog(db, {}, "rules_only")(shell("ls -la"));
		expect(decision.verdict).toBe("allow");
		expect(logged(db)).toMatchObject([{ answer: "allow", finalAction: "ask" }]);
	});

	test("an allowed action records no subject", async () => {
		const db = memoryDb();
		const decision = await gateWithLog(db)(shell("ls -la"));
		expect(decision.verdict).toBe("allow");
		expect(subjectOf(db, decision.decisionIds[0] as string)).toBeUndefined();
	});

	test("the rules-only fallback records a subject for an allow, which the client tightens to an ask", async () => {
		const db = memoryDb();
		const decision = await gateWithLog(db, {}, "rules_only")(shell("ls -la"));
		expect(decision.verdict).toBe("allow");
		expect(subjectOf(db, decision.decisionIds[0] as string)?.targets).toEqual([
			"ls -la",
		]);
	});

	test("the subject sees the checked-out branch the gate saw", async () => {
		const db = memoryDb();
		const decision = await gateWithLog(db, {
			branchOf: async () => ({ ok: true, value: "main" }),
		})(shell("git push"));
		expect(decision.verdict).toBe("ask");
		expect(subjectOf(db, decision.decisionIds[0] as string)?.classes).toContain(
			"git.push.protected",
		);
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

describe("branchCache (#459)", () => {
	test("never reuses a settled answer, so a checkout reaches the next push", async () => {
		const calls: string[] = [];
		const branch = ["feature", "master"];
		const branchOf = branchCache(async (root) => {
			calls.push(root);
			return branch[calls.length - 1] ?? null;
		});
		expect(await branchOf("/r")).toBe("feature");
		expect(await branchOf("/r")).toBe("master");
		expect(calls).toEqual(["/r", "/r"]);
	});

	test("a failed lookup is not remembered", async () => {
		let n = 0;
		const branchOf = branchCache(async () => {
			n++;
			if (n === 1) throw new Error("git gone");
			return "main";
		});
		await expect(branchOf("/r")).rejects.toThrow("git gone");
		expect(await branchOf("/r")).toBe("main");
	});

	test("keys by root, and concurrent lookups share one", async () => {
		const calls: string[] = [];
		const branchOf = branchCache(async (root) => {
			calls.push(root);
			return root === "/a" ? "main" : null;
		});
		const [a1, a2, b] = await Promise.all([
			branchOf("/a"),
			branchOf("/a"),
			branchOf("/b"),
		]);
		expect([a1, a2, b]).toEqual(["main", "main", null]);
		expect(calls).toEqual(["/a", "/b"]);
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

	// #459: the repo's protected branches and its checked-out branch reach
	// the classifier, so a push to either asks instead of being allowed.
	describe("protected branches", () => {
		let branchRepo = "";
		const run = (cwd: string, ...args: string[]) => {
			const p = Bun.spawnSync(["git", ...args], {
				cwd,
				stderr: "pipe",
				env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
			});
			if (p.exitCode !== 0) throw new Error(p.stderr.toString());
		};
		beforeAll(() => {
			branchRepo = realpathSync(mkdtempSync(join(tmpdir(), "maina-gate-br-")));
			run(branchRepo, "init", "-q");
			run(branchRepo, "checkout", "-q", "-b", "master");
			run(
				branchRepo,
				"-c",
				"user.email=t@example.com",
				"-c",
				"user.name=t",
				"-c",
				"commit.gpgsign=false",
				"commit",
				"-q",
				"--allow-empty",
				"-m",
				"init",
			);
		});
		afterAll(() => rmSync(branchRepo, { recursive: true, force: true }));

		test("a push to a branch the repo policy protects asks", async () => {
			const push = shell("git push origin v1/main", branchRepo);
			expect((await systemGates().runtime(push)).verdict).toBe("allow");
			mkdirSync(join(branchRepo, ".maina"), { recursive: true });
			writeFileSync(
				join(branchRepo, ".maina", "policy.json"),
				JSON.stringify({ protected_branches: ["v1/main"] }),
			);
			const decided = await systemGates().runtime(push);
			expect(decided.verdict).toBe("ask");
			expect(decided.reason).toContain("git.push.protected");
			expect((await systemGates().fallback(push)).verdict).toBe("ask");
		});

		test("a bare push while on a protected branch asks; on a feature branch it is allowed", async () => {
			run(branchRepo, "checkout", "-q", "-b", "feature/x");
			expect(
				(await systemGates().runtime(shell("git push", branchRepo))).verdict,
			).toBe("allow");
			run(branchRepo, "checkout", "-q", "master");
			expect(
				(await systemGates().runtime(shell("git push", branchRepo))).verdict,
			).toBe("ask");
			expect(
				(
					await systemGates().runtime(
						shell("git push -u origin HEAD", branchRepo),
					)
				).verdict,
			).toBe("ask");
		});
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

		// #448: the id in a real gate message resolves for `maina allow`.
		test("a real ask's id resolves for maina allow and --always", async () => {
			const repo = newRepo();
			const decided = await systemGates({ home }).runtime(
				shell("git push origin main", repo),
			);
			expect(decided.verdict).toBe("ask");
			const [id] = decided.decisionIds;
			const opened = openDecisionDb(join(repo, ".maina"));
			if (!opened.ok) throw new Error(opened.error);
			try {
				const { db } = opened.value;
				const subject = findGateSubject(db, id as string);
				if (!subject.ok || subject.value === undefined) {
					throw new Error(`no subject for ${id}`);
				}
				const rules = scopedAllowRules(subject.value);
				expect(rules.ok && rules.value.map((r) => r.match)).toEqual([
					"git push origin main",
				]);
				const overridden = recordOverride(
					{ db, clock: { now: () => 7 } },
					id as string,
				);
				expect(overridden.ok).toBe(true);
			} finally {
				opened.value.close();
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
