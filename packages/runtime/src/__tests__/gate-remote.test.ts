/**
 * Remote approvals in the gate path (#593, cloud plan Task 7.3): an `ask`
 * whose route (from the managed policy) is not local becomes a remote ask,
 * and the gate waits on it inside the hook's budget. The host then gets the
 * approver's allow or deny, or its local ask with a waiting line that links
 * to the ask. The fallback never goes remote, and neither does a machine
 * without a managed policy.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DEFAULT_POLICY,
	type GateContext,
	loadShellParser,
	type Policy,
} from "@mainahq/core";
import { runClaudeHook } from "../claude-hook";
import { runCodexHook } from "../codex-hook";
import { runCursorHook } from "../cursor-hook";
import {
	createGateEvaluator,
	type GateApprovals,
	type GateDecision,
	type GateEvaluatorDeps,
	type GateEvent,
	parseGateDecision,
} from "../gate";
import type {
	ApprovalRoute,
	RemoteApproval,
	RemoteAsk,
} from "../link/approvals";

const ROOT = "/work/repo";
const ETAG = `sha256:${"d".repeat(64)}`;
let ctx: GateContext;

beforeAll(async () => {
	const shell = await loadShellParser();
	if (!shell.ok) throw new Error(shell.error.message);
	ctx = { shell: shell.value, home: "/home/dev" };
});

/** The effective policy on an enrolled machine holding the org's bundle. */
const MANAGED: Policy = {
	...DEFAULT_POLICY,
	managed: {
		version: 3,
		etag: ETAG,
		signature: "signed",
		keyId: "key_policy_1",
		issuedAt: "2026-09-28T08:00:00.000Z",
		budgetDirectives: [],
		askFloor: [],
		overridden: [],
	},
};

const REMOTE: ApprovalRoute = {
	target: "remote",
	timeoutMs: 600_000,
	onTimeout: "deny",
};

type Seen = { asks: RemoteAsk[]; routes: ApprovalRoute[]; waits: number[] };

function approvals(
	answer: RemoteApproval,
	route: ApprovalRoute = REMOTE,
): GateApprovals & { seen: Seen } {
	const seen: Seen = { asks: [], routes: [], waits: [] };
	return {
		seen,
		routeFor: () => route,
		awaitRemoteApproval: async (ask, r, { timeoutMs }) => {
			seen.asks.push(ask);
			seen.routes.push(r);
			seen.waits.push(timeoutMs);
			return answer;
		},
		waitMs: 1_200,
	};
}

function deps(overrides: Partial<GateEvaluatorDeps> = {}): GateEvaluatorDeps {
	let n = 0;
	return {
		rootOf: () => ROOT,
		policyFor: async () => ({ ok: true, value: MANAGED }),
		context: async () => ctx,
		clock: { now: () => 0 },
		newId: () => `d-${++n}`,
		...overrides,
	};
}

const push: GateEvent = {
	kind: "shell",
	input: { command: "git push origin main", host: "claude-code" },
	cwd: ROOT,
};

const APPROVED: RemoteApproval = {
	outcome: "allow",
	note: { status: "approved", by: "member mem_7c1d" },
};
const DENIED: RemoteApproval = {
	outcome: "deny",
	note: { status: "denied", by: "member mem_alice" },
};
const WAITING: RemoteApproval = {
	outcome: "ask-local",
	note: { status: "waiting", link: "https://app.cloud.test/approvals/apr_1" },
};

const FIXTURES = join(import.meta.dir, "..", "adapters", "__fixtures__");
const input = (host: string, name: string, command: string): string => {
	const raw = JSON.parse(
		readFileSync(join(FIXTURES, host, name), "utf8"),
	) as Record<string, unknown>;
	return JSON.stringify(
		host === "cursor" && "command" in raw
			? { ...raw, command, cwd: ROOT }
			: { ...raw, cwd: ROOT, tool_input: { command } },
	);
};

/** The decision as the hook client gets it over IPC. */
const overWire = (decision: GateDecision): GateDecision => {
	const parsed = parseGateDecision(JSON.parse(JSON.stringify(decision)));
	if (parsed === null) throw new Error("the decision did not survive the wire");
	return parsed;
};

const hookPorts = (decision: GateDecision) => ({
	evaluate: async () => overWire(decision),
	sessionSummary: async () => undefined,
});

describe("an ask routed to remote approvers", () => {
	test("approved: the host receives allow", async () => {
		const port = approvals(APPROVED);
		const gate = createGateEvaluator(deps({ approvals: port }));
		const decision = await gate(push);
		expect(decision.verdict).toBe("allow");
		expect(decision.approval).toEqual(APPROVED.note);
		// The ask names the class and the managed policy, and waits no longer
		// than the hook allows.
		expect(port.seen.asks[0]).toMatchObject({
			actionClass: "git.push.protected",
			irreversible: false,
			policyHash: ETAG,
		});
		expect(port.seen.waits).toEqual([1_200]);

		const run = await runClaudeHook(
			input(
				"claude-code",
				"pre-tool-use.bash.input.json",
				"git push origin main",
			),
			hookPorts(decision),
			"PreToolUse",
		);
		const out = JSON.parse(run.output.stdout);
		expect(out.hookSpecificOutput.permissionDecision).toBe("allow");
		expect(out.hookSpecificOutput.permissionDecisionReason).toContain(
			"approved by member mem_7c1d",
		);
	});

	test("denied: deny, with the approver's name in the message", async () => {
		const gate = createGateEvaluator(deps({ approvals: approvals(DENIED) }));
		const decision = await gate(push);
		expect(decision.verdict).toBe("deny");

		const run = await runClaudeHook(
			input(
				"claude-code",
				"pre-tool-use.bash.input.json",
				"git push origin main",
			),
			hookPorts(decision),
			"PreToolUse",
		);
		expect(run.output.exitCode).toBe(2);
		const reason = JSON.parse(run.output.stdout).hookSpecificOutput
			.permissionDecisionReason as string;
		expect(reason).toContain("denied by member mem_alice");
		// An approver's denial is not offered as a local override.
		expect(reason).not.toContain("maina allow");
	});

	test("waiting: the local ask carries a line linking to the ask", async () => {
		const gate = createGateEvaluator(deps({ approvals: approvals(WAITING) }));
		const decision = await gate(push);
		expect(decision.verdict).toBe("ask");

		const claude = await runClaudeHook(
			input(
				"claude-code",
				"pre-tool-use.bash.input.json",
				"git push origin main",
			),
			hookPorts(decision),
			"PreToolUse",
		);
		const reason = JSON.parse(claude.output.stdout).hookSpecificOutput
			.permissionDecisionReason as string;
		expect(reason).toContain(
			"waiting for approval: https://app.cloud.test/approvals/apr_1",
		);

		// Codex and Cursor's preToolUse cannot ask: they block with the link
		// and tell the agent to retry once the ask is approved.
		const codex = await runCodexHook(
			input("codex", "pre-tool-use.bash.input.json", "git push origin main"),
			hookPorts(decision),
			"PreToolUse",
		);
		expect(codex.output.exitCode).toBe(2);
		expect(codex.output.stderr).toContain(
			"https://app.cloud.test/approvals/apr_1",
		);
		expect(codex.output.stderr).toContain("retry");

		const write = JSON.parse(
			readFileSync(
				join(FIXTURES, "cursor", "pre-tool-use.write.input.json"),
				"utf8",
			),
		) as Record<string, unknown>;
		const cursor = await runCursorHook(
			JSON.stringify({
				...write,
				cwd: ROOT,
				tool_input: { file_path: `${ROOT}/src/x.ts`, content: "x" },
			}),
			hookPorts(decision),
			"preToolUse",
		);
		const out = JSON.parse(cursor.output.stdout);
		expect(out.permission).toBe("deny");
		expect(out.user_message).toContain(
			"https://app.cloud.test/approvals/apr_1",
		);
		expect(out.agent_message).toContain("retry");

		// Cursor's beforeShellExecution can ask: its prompt carries the link.
		const shell = await runCursorHook(
			input(
				"cursor",
				"before-shell-execution.input.json",
				"git push origin main",
			),
			hookPorts(decision),
			"beforeShellExecution",
		);
		const asked = JSON.parse(shell.output.stdout);
		expect(asked.permission).toBe("ask");
		expect(asked.user_message).toContain(
			"https://app.cloud.test/approvals/apr_1",
		);
	});

	test("an irreversible class says so to the route and the approvals", async () => {
		const port = approvals(WAITING);
		const gate = createGateEvaluator(deps({ approvals: port }));
		await gate({ kind: "shell", input: { command: "rm -rf /" }, cwd: ROOT });
		expect(port.seen.asks[0]).toMatchObject({
			actionClass: "fs.delete.recursive",
			irreversible: true,
		});
	});

	test("a retry of the same action names the same ask", async () => {
		const port = approvals(WAITING);
		const gate = createGateEvaluator(deps({ approvals: port }));
		await gate(push);
		await gate(push);
		await gate({
			...push,
			input: { ...push.input, command: "git push origin master" },
		});
		const [a, b, c] = port.seen.asks;
		expect(a?.key).toBe(b?.key ?? "");
		expect(c?.key).not.toBe(a?.key);
	});
});

describe("asks that stay local", () => {
	test("a local route never waits", async () => {
		const port = approvals(APPROVED, { ...REMOTE, target: "local" });
		const decision = await createGateEvaluator(deps({ approvals: port }))(push);
		expect(decision.verdict).toBe("ask");
		expect(decision.approval).toBeUndefined();
		expect(port.seen.asks).toHaveLength(0);
	});

	test("the rules-only fallback never goes remote", async () => {
		const port = approvals(APPROVED);
		const decision = await createGateEvaluator(
			deps({ approvals: port }),
			"rules_only",
		)(push);
		expect(decision.verdict).toBe("ask");
		expect(port.seen.asks).toHaveLength(0);
	});

	test("a machine without a managed policy never goes remote", async () => {
		const port = approvals(APPROVED);
		const decision = await createGateEvaluator(
			deps({
				approvals: port,
				policyFor: async () => ({ ok: true, value: DEFAULT_POLICY }),
			}),
		)(push);
		expect(decision.verdict).toBe("ask");
		expect(port.seen.asks).toHaveLength(0);
	});

	test("an allow or a deny is never sent for approval", async () => {
		const port = approvals(APPROVED);
		const gate = createGateEvaluator(deps({ approvals: port }));
		expect((await gate({ ...push, input: { command: "ls" } })).verdict).toBe(
			"allow",
		);
		expect(port.seen.asks).toHaveLength(0);
	});

	test("an approvals port that throws leaves the local ask", async () => {
		const port: GateApprovals = {
			...approvals(APPROVED),
			awaitRemoteApproval: async () => {
				throw new Error("boom");
			},
		};
		const decision = await createGateEvaluator(deps({ approvals: port }))(push);
		expect(decision.verdict).not.toBe("allow");
	});
});

describe("the approval note on the wire", () => {
	test("a malformed note is refused, never read as no note", () => {
		const base = {
			verdict: "allow",
			reason: "r",
			decisionIds: [],
			degraded: false,
		};
		expect(
			parseGateDecision({ ...base, approval: { status: "nope" } }),
		).toBeNull();
		expect(
			parseGateDecision({ ...base, approval: { status: "approved", by: 7 } }),
		).toBeNull();
		expect(
			parseGateDecision({ ...base, approval: { status: "approved" } })
				?.approval,
		).toEqual({ status: "approved" });
	});
});
