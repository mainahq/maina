/**
 * The runtime's gate evaluators (FR-GATE-1, FR-GATE-3): the wire event is
 * normalised into a core `GateEvent` and run through `evaluateGate`, both in
 * the daemon and in the hook client's rules-only fallback. Every path that
 * cannot evaluate (no working directory, no repository, a bad policy, a
 * malformed event, a failing port) asks.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Backend,
	createRegistry,
	DEFAULT_POLICY,
	DEFAULT_REGISTRY,
	type GateContext,
	loadShellParser,
	type Policy,
} from "@mainahq/core";
import { createHookClient } from "../client/hook-client";
import {
	createGateEvaluator,
	type GateEvaluatorDeps,
	type GateEvent,
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
	] as const)("%s asks", async (_label, d, event) => {
		const decision = await createGateEvaluator(d)(event);
		expect(decision.verdict).toBe("ask");
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
			expect(harmless).toMatchObject({ verdict: "ask", degraded: true });
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
