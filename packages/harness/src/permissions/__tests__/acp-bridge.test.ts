/**
 * The ACP permission bridge (FR-HAR-2): every `session/request_permission`
 * an ACP agent sends is judged by core's `evaluateGate` and logged, and the
 * verdict picks the option the agent is answered with.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PermissionOption,
	ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { FakeScript } from "../../__fixtures__/fake-acp-agent";
import {
	type HarnessEvent,
	INITIAL_STATE,
	normalisePermission,
	type PermissionRequest,
} from "../../events";
import { startRun } from "../../orchestrator";
import { acpGatePolicy, bridgeAcpPermission } from "../acp-bridge";
import { type TestBridge, testBridge } from "./gate-fixture";

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "maina-acp-bridge-")));
const CTX = { host: "acp:fake", sessionId: "s-1", root: ROOT } as const;

const ONCE: readonly PermissionOption[] = [
	{ optionId: "yes", name: "Allow", kind: "allow_once" },
	{ optionId: "always", name: "Always", kind: "allow_always" },
	{ optionId: "no", name: "Reject", kind: "reject_once" },
];

function request(
	toolCall: ToolCallUpdate,
	options: readonly PermissionOption[] = ONCE,
): PermissionRequest {
	return normalisePermission(
		INITIAL_STATE,
		{ sessionId: CTX.sessionId, toolCall, options: [...options] },
		CTX,
	).request;
}

const shellCall = (id: string, command: string): ToolCallUpdate => ({
	toolCallId: id,
	kind: "execute",
	title: command,
	rawInput: { command },
});

let bridge: TestBridge;
beforeAll(async () => {
	bridge = await testBridge();
});

describe("bridgeAcpPermission", () => {
	test("an allowed call is answered allow_once, never a standing allow", () => {
		bridge.records.length = 0;
		const answer = bridgeAcpPermission(bridge, request(shellCall("t1", "ls")));
		expect(answer).toMatchObject({
			verdict: "allow",
			kind: "allow_once",
			optionId: "yes",
		});
	});

	test("a denied call is answered reject_once with the gate's reason", () => {
		const answer = bridgeAcpPermission(
			bridge,
			request(shellCall("t2", "npm publish")),
		);
		expect(answer).toMatchObject({
			verdict: "deny",
			kind: "reject_once",
			optionId: "no",
		});
		expect(answer.reason).toContain("npm publish");
	});

	test("ask rejects: a headless run has nobody to ask", () => {
		const answer = bridgeAcpPermission(
			bridge,
			request(shellCall("t3", "rm -rf /var/data")),
		);
		expect(answer).toMatchObject({ verdict: "ask", kind: "reject_once" });
	});

	test("an opaque call (no readable command) is never allowed", () => {
		const answer = bridgeAcpPermission(
			bridge,
			request({ toolCallId: "t4", kind: "execute", title: "Run" }),
		);
		expect(answer.verdict).toBe("ask");
		expect(answer.kind).toBe("reject_once");
	});

	test("an allow with no allow_once on offer is answered cancelled", () => {
		const answer = bridgeAcpPermission(
			bridge,
			request(shellCall("t5", "ls"), [
				{ optionId: "always", name: "Always", kind: "allow_always" },
				{ optionId: "no", name: "Reject", kind: "reject_once" },
			]),
		);
		expect(answer).toMatchObject({ verdict: "allow", kind: "cancelled" });
		expect(answer.optionId).toBeUndefined();
	});

	test("every request is evaluated and logged, in order, with its answer", () => {
		const log = bridge.records;
		log.length = 0;
		bridgeAcpPermission(bridge, request(shellCall("a", "ls")));
		bridgeAcpPermission(bridge, request(shellCall("b", "npm publish")));
		bridgeAcpPermission(
			bridge,
			request({ toolCallId: "c", kind: "think", title: "Plan" }),
		);
		expect(log.map((r) => [r.toolCallId, r.verdict, r.answer])).toEqual([
			["a", "allow", "allow_once"],
			["b", "deny", "reject_once"],
			["c", "allow", "allow_once"],
		]);
		expect(log[1]).toMatchObject({
			source: "acp",
			host: "acp:fake",
			sessionId: "s-1",
			opaque: false,
			gate: [expect.objectContaining({ kind: "shell" })],
		});
	});

	test("a log that throws never changes the answer", () => {
		const answer = bridgeAcpPermission(
			{
				...bridge,
				log: () => {
					throw new Error("disk full");
				},
			},
			request(shellCall("t6", "npm publish")),
		);
		expect(answer.verdict).toBe("deny");
	});
});

describe("acpGatePolicy with startRun", () => {
	const FIXTURE = join(
		import.meta.dir,
		"..",
		"..",
		"__fixtures__",
		"fake-acp-agent.ts",
	);

	test("each session/request_permission of a real ACP session is gated and logged", async () => {
		bridge.records.length = 0;
		const permission = (toolCall: ToolCallUpdate) => ({
			permission: { toolCall, options: [...ONCE] },
		});
		const script: FakeScript = {
			steps: [
				permission(shellCall("p1", "ls -la")),
				permission(shellCall("p2", "npm publish")),
			],
		};
		const run = startRun({
			agent: {
				name: "fake",
				command: process.execPath,
				args: [FIXTURE, JSON.stringify(script)],
			},
			task: "ship it",
			root: ROOT,
			policy: acpGatePolicy(bridge),
		});
		const events: HarnessEvent[] = [];
		for await (const event of run.events) events.push(event);

		const echoed = events.flatMap((e) =>
			e.type === "message" ? [e.text] : [],
		);
		expect(echoed).toEqual(["permission:yes", "permission:no"]);
		expect(bridge.records.map((r) => [r.toolCallId, r.verdict])).toEqual([
			["p1", "allow"],
			["p2", "deny"],
		]);
		expect(bridge.records.every((r) => r.host === "acp:fake")).toBe(true);
	});
});
