/**
 * One Codex hook run (mainahq/maina#475): raw stdin → `fromCodex` → the gate
 * for every action (or the session summary) → `toCodex`. An `apply_patch`
 * is one gate event per file, and the strictest verdict wins. The ports are
 * fakes here, except in the last block, which runs the real rules-only gate.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeHookPorts } from "../claude-hook";
import { runCodexHook } from "../codex-hook";
import type { GateDecision, GateEvent } from "../gate";
import { systemGates } from "../gate-system";

const DIR = join(import.meta.dir, "..", "adapters", "__fixtures__", "codex");
const raw = (name: string): string => readFileSync(join(DIR, name), "utf8");
const parsed = (stdout: string): unknown => JSON.parse(stdout);

const decision = (
	verdict: GateDecision["verdict"],
	reason = `fixed ${verdict}`,
	extra: Partial<GateDecision> = {},
): GateDecision => ({
	verdict,
	reason,
	decisionIds: [],
	degraded: false,
	...extra,
});

function ports(
	answer: (event: GateEvent) => GateDecision = () => decision("allow"),
	overrides: Partial<ClaudeHookPorts> = {},
): ClaudeHookPorts & { seen: GateEvent[] } {
	const seen: GateEvent[] = [];
	return {
		seen,
		evaluate: async (event) => {
			seen.push(event);
			return answer(event);
		},
		sessionSummary: async () => undefined,
		...overrides,
	};
}

/** An apply_patch payload that touches `paths`, one Add File each. */
function patch(paths: readonly string[]): string {
	const payload = parsed(raw("pre-tool-use.apply-patch.input.json")) as Record<
		string,
		unknown
	>;
	const body = paths.map((p) => `*** Add File: ${p}\n+x`).join("\n");
	return JSON.stringify({
		...payload,
		tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch\n` },
	});
}

const pathOf = (event: GateEvent): unknown => event.input.path;

describe("runCodexHook", () => {
	test("gates a shell command and allows it silently", async () => {
		const p = ports();
		const run = await runCodexHook(
			raw("pre-tool-use.bash.input.json"),
			p,
			"PreToolUse",
		);
		expect(p.seen.map((e) => e.kind)).toEqual(["shell"]);
		expect(p.seen[0]?.input.host).toBe("codex");
		expect(run.decision?.verdict).toBe("allow");
		expect(run.output).toEqual({ exitCode: 0, stdout: "{}\n", stderr: "" });
	});

	test("an ask on PreToolUse is a deny with exit 2, never an ask", async () => {
		const run = await runCodexHook(
			raw("pre-tool-use.bash.input.json"),
			ports(() => decision("ask", "confirm it")),
			"PreToolUse",
		);
		expect(run.decision?.verdict).toBe("ask");
		expect(run.output.exitCode).toBe(2);
		expect(run.output.stdout).not.toContain('"ask"');
		expect(parsed(run.output.stdout)).toMatchObject({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
			},
		});
		expect(run.output.stderr).toContain("confirm it");
	});

	test("an apply_patch gates every file it writes", async () => {
		const p = ports();
		await runCodexHook(patch(["a.txt", "b.txt", "c.txt"]), p, "PreToolUse");
		expect(p.seen.map((e) => e.kind)).toEqual([
			"file.write",
			"file.write",
			"file.write",
		]);
		expect(p.seen.map(pathOf)).toEqual(["a.txt", "b.txt", "c.txt"]);
	});

	test("the strictest verdict across the files wins: one ask blocks the patch", async () => {
		const run = await runCodexHook(
			patch(["ok.txt", "outside.txt", "fine.txt"]),
			ports((e) =>
				pathOf(e) === "outside.txt"
					? decision("ask", "outside the workspace", { decisionIds: ["d2"] })
					: decision("allow", "no rule matched", { decisionIds: ["d1"] }),
			),
			"PreToolUse",
		);
		expect(run.decision?.verdict).toBe("ask");
		expect(run.decision?.reason).toContain("outside the workspace");
		expect(run.decision?.decisionIds).toContain("d2");
		expect(run.output.exitCode).toBe(2);
	});

	test("a deny on any file beats an ask on another", async () => {
		const run = await runCodexHook(
			patch(["a.txt", "secret.env"]),
			ports((e) =>
				pathOf(e) === "secret.env"
					? decision("deny", "writes a secret")
					: decision("ask", "confirm it"),
			),
			"PreToolUse",
		);
		expect(run.decision?.verdict).toBe("deny");
		expect(run.decision?.reason).toContain("writes a secret");
		expect(run.output.exitCode).toBe(2);
		expect(run.output.stderr).toContain("writes a secret");
	});

	test("one degraded file marks the whole decision degraded", async () => {
		const run = await runCodexHook(
			patch(["a.txt", "b.txt"]),
			ports((e) => decision("deny", "no", { degraded: pathOf(e) === "a.txt" })),
			"PreToolUse",
		);
		expect(run.decision?.degraded).toBe(true);
	});

	test("a gate that throws for one file never allows the patch", async () => {
		const run = await runCodexHook(
			patch(["a.txt", "b.txt"]),
			ports((e) => {
				if (pathOf(e) === "b.txt") throw new Error("boom");
				return decision("allow");
			}),
			"PreToolUse",
		);
		expect(run.decision?.verdict).not.toBe("allow");
		expect(run.output.exitCode).toBe(2);
	});

	test("input that is not JSON denies on PreToolUse without calling the gate", async () => {
		const p = ports();
		const run = await runCodexHook("", p, "PreToolUse");
		expect(p.seen).toHaveLength(0);
		expect(run.decision?.verdict).toBe("ask");
		expect(run.output.exitCode).toBe(2);
		expect(parsed(run.output.stdout)).toMatchObject({
			hookSpecificOutput: { permissionDecision: "deny" },
		});
	});

	test("PermissionRequest: an ask keeps Codex's own prompt", async () => {
		const run = await runCodexHook(
			raw("permission-request.bash.input.json"),
			ports(() => decision("ask")),
			"PermissionRequest",
		);
		expect(run.output).toEqual({ exitCode: 0, stdout: "{}\n", stderr: "" });
	});

	test("SessionStart adds the guardrails notice and the summary", async () => {
		const run = await runCodexHook(
			raw("session-start.startup.input.json"),
			ports(undefined, {
				sessionSummary: async () => "maina session: 1 blocked",
			}),
			"SessionStart",
		);
		expect(parsed(run.output.stdout)).toEqual({
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext:
					"maina guardrails active for this repository. maina session: 1 blocked",
			},
		});
	});

	test("Stop carries the summary; a failing summary is left out", async () => {
		const run = await runCodexHook(
			raw("stop.input.json"),
			ports(undefined, { sessionSummary: async () => "maina session: 2" }),
			"Stop",
		);
		expect(parsed(run.output.stdout)).toEqual({
			systemMessage: "maina session: 2",
		});
		const failed = await runCodexHook(
			raw("stop.input.json"),
			ports(undefined, {
				sessionSummary: async () => {
					throw new Error("db locked");
				},
			}),
			"Stop",
		);
		expect(failed.output).toEqual({ exitCode: 0, stdout: "{}\n", stderr: "" });
	});

	test("PostToolUse is ignored without calling the gate", async () => {
		const p = ports();
		const run = await runCodexHook(
			raw("post-tool-use.bash.input.json"),
			p,
			"PostToolUse",
		);
		expect(p.seen).toHaveLength(0);
		expect(run.output.stdout).toBe("{}\n");
	});
});

describe("runCodexHook over the real rules-only gate", () => {
	let repo: string;
	const gate = systemGates().fallback;
	const real: ClaudeHookPorts = {
		evaluate: async (event) => gate(event),
		sessionSummary: async () => undefined,
	};

	beforeAll(() => {
		repo = mkdtempSync(join(tmpdir(), "maina-codex-hook-"));
		Bun.spawnSync(["git", "init", "-q", repo]);
	});
	afterAll(() => rmSync(repo, { recursive: true, force: true }));

	const shell = (command: string): string =>
		JSON.stringify({
			...(parsed(raw("pre-tool-use.bash.input.json")) as object),
			tool_input: { command },
			cwd: repo,
		});

	test("a plain command is allowed; a destructive one is blocked", async () => {
		const plain = await runCodexHook(shell("echo hello"), real, "PreToolUse");
		expect(plain.decision?.verdict).toBe("allow");
		const destructive = await runCodexHook(
			shell("rm -rf /"),
			real,
			"PreToolUse",
		);
		expect(destructive.decision?.verdict).not.toBe("allow");
		expect(destructive.output.exitCode).toBe(2);
	});
});
