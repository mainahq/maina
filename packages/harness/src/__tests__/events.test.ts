import { describe, expect, test } from "bun:test";
import type {
	PermissionOption,
	SessionUpdate,
	ToolKind,
} from "@agentclientprotocol/sdk";
import {
	chooseOption,
	type HarnessEvent,
	INITIAL_STATE,
	isVerdict,
	type NormaliseContext,
	type NormaliseState,
	normalisePermission,
	normaliseUpdate,
} from "../events";

const CTX: NormaliseContext = {
	host: "acp:fake",
	sessionId: "s1",
	root: "/work/repo",
};

const BASE = {
	host: "acp:fake",
	sessionId: "s1",
	root: "/work/repo",
	permissionMode: "unknown",
	untrusted: [],
} as const;

/** Feeds updates through the reducer and returns every event, in order. */
function run(
	updates: readonly SessionUpdate[],
	state: NormaliseState = INITIAL_STATE,
): { events: readonly HarnessEvent[]; state: NormaliseState } {
	const events: HarnessEvent[] = [];
	let current = state;
	for (const update of updates) {
		const next = normaliseUpdate(current, update, CTX);
		events.push(...next.events);
		current = next.state;
	}
	return { events, state: current };
}

const toolCall = (
	kind: ToolKind,
	extra: Record<string, unknown> = {},
): SessionUpdate => ({
	sessionUpdate: "tool_call",
	toolCallId: `call-${kind}`,
	title: `a ${kind} call`,
	kind,
	status: "pending",
	...extra,
});

describe("normaliseUpdate: every tool-call update maps to a normalised event", () => {
	const KINDS: readonly ToolKind[] = [
		"read",
		"edit",
		"delete",
		"move",
		"search",
		"execute",
		"think",
		"fetch",
		"switch_mode",
		"other",
	];

	for (const kind of KINDS) {
		test(`tool_call and tool_call_update of kind ${kind} each yield one tool event`, () => {
			const { events } = run([
				toolCall(kind),
				{
					sessionUpdate: "tool_call_update",
					toolCallId: `call-${kind}`,
					status: "completed",
				},
			]);
			const tools = events.filter((e) => e.type === "tool");
			expect(tools).toHaveLength(2);
			expect(tools[0]).toMatchObject({
				type: "tool",
				update: "call",
				call: { toolCallId: `call-${kind}`, kind, status: "pending" },
			});
			expect(tools[1]).toMatchObject({
				type: "tool",
				update: "update",
				call: { toolCallId: `call-${kind}`, kind, status: "completed" },
			});
		});
	}

	test("an execute call is a shell gate event with its command and cwd", () => {
		const { events } = run([
			toolCall("execute", {
				rawInput: { command: "git push --force", cwd: "/work/repo/sub" },
			}),
		]);
		expect(events[0]).toMatchObject({
			type: "tool",
			opaque: false,
			gate: [
				{
					...BASE,
					kind: "shell",
					action: { command: "git push --force", cwd: "/work/repo/sub" },
				},
			],
		});
	});

	test("an argv command is quoted back into one shell string", () => {
		const { events } = run([
			toolCall("execute", { rawInput: { command: ["rm", "-rf", "my dir"] } }),
		]);
		expect(events[0]).toMatchObject({
			gate: [{ kind: "shell", action: { command: "rm -rf 'my dir'" } }],
		});
	});

	test("an execute call with no readable command is opaque, never silently ungated", () => {
		const { events } = run([toolCall("execute", { rawInput: {} })]);
		expect(events[0]).toMatchObject({ type: "tool", gate: [], opaque: true });
	});

	test("an edit is a file.write per path, carrying the diff's new text", () => {
		const { events } = run([
			toolCall("edit", {
				locations: [{ path: "/work/repo/a.ts" }],
				content: [
					{
						type: "diff",
						path: "/work/repo/a.ts",
						oldText: "old",
						newText: "new",
					},
				],
			}),
		]);
		expect(events).toEqual([
			expect.objectContaining({
				type: "tool",
				opaque: false,
				gate: [
					{
						...BASE,
						kind: "file.write",
						action: { path: "/work/repo/a.ts", content: "new" },
					},
				],
			}),
			{
				type: "diff",
				toolCallId: "call-edit",
				path: "/work/repo/a.ts",
				oldText: "old",
				newText: "new",
			},
		]);
	});

	test("a delete writes its target and a move writes both ends", () => {
		const del = run([
			toolCall("delete", { rawInput: { path: "/work/repo/gone.ts" } }),
		]);
		expect(del.events[0]).toMatchObject({
			gate: [{ kind: "file.write", action: { path: "/work/repo/gone.ts" } }],
		});
		const move = run([
			toolCall("move", {
				locations: [{ path: "/work/repo/a.ts" }, { path: "/work/repo/b.ts" }],
			}),
		]);
		expect(move.events[0]).toMatchObject({
			gate: [
				{ kind: "file.write", action: { path: "/work/repo/a.ts" } },
				{ kind: "file.write", action: { path: "/work/repo/b.ts" } },
			],
		});
	});

	test("an edit with no path is opaque", () => {
		const { events } = run([toolCall("edit")]);
		expect(events[0]).toMatchObject({ gate: [], opaque: true });
	});

	test("a read outside the root is file.read.outside; inside it is not gated", () => {
		const outside = run([
			toolCall("read", { locations: [{ path: "/etc/passwd" }] }),
		]);
		expect(outside.events[0]).toMatchObject({
			opaque: false,
			gate: [
				{ ...BASE, kind: "file.read.outside", action: { path: "/etc/passwd" } },
			],
		});
		const inside = run([
			toolCall("read", { locations: [{ path: "/work/repo/src/a.ts" }] }),
		]);
		expect(inside.events[0]).toMatchObject({ gate: [], opaque: false });
		const sibling = run([
			toolCall("read", { locations: [{ path: "/work/repo-other/a.ts" }] }),
		]);
		expect(sibling.events[0]).toMatchObject({
			gate: [{ kind: "file.read.outside" }],
		});
	});

	test("a search under a path outside the root reads outside; inside or pathless it is not gated", () => {
		const outside = run([
			toolCall("search", {
				rawInput: { pattern: "KEY", path: "/home/dev/.ssh" },
			}),
		]);
		expect(outside.events[0]).toMatchObject({
			opaque: false,
			gate: [
				{
					...BASE,
					kind: "file.read.outside",
					action: { path: "/home/dev/.ssh" },
				},
			],
		});
		const located = run([
			toolCall("search", { locations: [{ path: "/etc" }] }),
		]);
		expect(located.events[0]).toMatchObject({
			gate: [{ kind: "file.read.outside", action: { path: "/etc" } }],
		});
		const inside = run([
			toolCall("search", { rawInput: { pattern: "x", path: "src" } }),
		]);
		expect(inside.events[0]).toMatchObject({ gate: [], opaque: false });
		const pathless = run([toolCall("search", { rawInput: { pattern: "x" } })]);
		expect(pathless.events[0]).toMatchObject({ gate: [], opaque: false });
	});

	test("a fetch is a network gate event", () => {
		const { events } = run([
			toolCall("fetch", { rawInput: { url: "https://example.com/x" } }),
		]);
		expect(events[0]).toMatchObject({
			gate: [
				{ ...BASE, kind: "network", action: { url: "https://example.com/x" } },
			],
		});
	});

	test("an MCP tool name is an mcp gate event whatever its kind", () => {
		const { events } = run([
			toolCall("other", {
				name: "mcp__github__create_issue",
				rawInput: { title: "hi" },
			}),
		]);
		expect(events[0]).toMatchObject({
			gate: [
				{
					...BASE,
					kind: "mcp",
					action: {
						server: "github",
						tool: "create_issue",
						input: { title: "hi" },
					},
				},
			],
		});
	});

	test("kinds that do not act are not gated", () => {
		for (const kind of ["search", "think", "switch_mode", "other"] as const) {
			const { events } = run([toolCall(kind)]);
			expect(events[0]).toMatchObject({ gate: [], opaque: false });
		}
	});

	test("a tool_call_update merges into the call it updates", () => {
		const { events } = run([
			toolCall("execute", { rawInput: {} }),
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "call-execute",
				status: "in_progress",
				rawInput: { command: "ls" },
			},
		]);
		expect(events[1]).toMatchObject({
			type: "tool",
			update: "update",
			call: {
				toolCallId: "call-execute",
				kind: "execute",
				title: "a execute call",
				status: "in_progress",
			},
			gate: [{ kind: "shell", action: { command: "ls" } }],
			opaque: false,
		});
	});

	test("an update for an unknown call still yields a tool event", () => {
		const { events } = run([
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "late",
				kind: "execute",
				rawInput: { command: "make" },
			},
		]);
		expect(events[0]).toMatchObject({
			type: "tool",
			update: "update",
			call: { toolCallId: "late", kind: "execute", status: "pending" },
			gate: [{ kind: "shell", action: { command: "make" } }],
		});
	});

	test("a diff repeated in a later update is reported once", () => {
		const diff = {
			type: "diff" as const,
			path: "/work/repo/a.ts",
			newText: "new",
		};
		const { events } = run([
			toolCall("edit", { content: [diff] }),
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "call-edit",
				status: "completed",
				content: [diff],
			},
		]);
		expect(events.filter((e) => e.type === "diff")).toHaveLength(1);
	});
});

describe("normaliseUpdate: messages", () => {
	test("text chunks are messages by role; other updates are dropped", () => {
		const { events } = run([
			{
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "hello" },
			},
			{
				sessionUpdate: "agent_thought_chunk",
				content: { type: "text", text: "hmm" },
			},
			{
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text: "do it" },
			},
			{ sessionUpdate: "plan", entries: [] },
		]);
		expect(events).toEqual([
			{ type: "message", role: "agent", text: "hello" },
			{ type: "message", role: "thought", text: "hmm" },
			{ type: "message", role: "user", text: "do it" },
		]);
	});
});

describe("normalisePermission", () => {
	test("a permission request is normalised against the call it is about", () => {
		const { state } = run([
			toolCall("execute", { rawInput: { command: "rm -rf /" } }),
		]);
		const request = normalisePermission(
			state,
			{
				sessionId: "s1",
				toolCall: { toolCallId: "call-execute" },
				options: [{ optionId: "ok", name: "Allow", kind: "allow_once" }],
			},
			CTX,
		);
		expect(request.request).toMatchObject({
			toolCallId: "call-execute",
			call: { kind: "execute", title: "a execute call" },
			gate: [{ kind: "shell", action: { command: "rm -rf /" } }],
			opaque: false,
			options: [{ optionId: "ok", name: "Allow", kind: "allow_once" }],
		});
	});
});

describe("chooseOption", () => {
	const OPTIONS: readonly PermissionOption[] = [
		{ optionId: "always", name: "Always", kind: "allow_always" },
		{ optionId: "once", name: "Once", kind: "allow_once" },
		{ optionId: "no", name: "No", kind: "reject_once" },
		{ optionId: "never", name: "Never", kind: "reject_always" },
	];

	test("allow picks a one-off allow, never a standing one", () => {
		expect(chooseOption(OPTIONS, "allow")).toBe("once");
	});

	test("deny and ask both reject: no human is in the loop to ask", () => {
		expect(chooseOption(OPTIONS, "deny")).toBe("no");
		expect(chooseOption(OPTIONS, "ask")).toBe("no");
	});

	test("an allow never falls back to a standing allow: it would outlive the verdict", () => {
		expect(
			chooseOption(
				[
					{ optionId: "a", name: "A", kind: "allow_always" },
					{ optionId: "no", name: "No", kind: "reject_once" },
				],
				"allow",
			),
		).toBeUndefined();
	});

	test("a reject falls back to the standing reject: stricter is still closed", () => {
		expect(
			chooseOption(
				[{ optionId: "r", name: "R", kind: "reject_always" }],
				"deny",
			),
		).toBe("r");
	});

	test("no option of the right polarity cancels rather than allowing", () => {
		expect(
			chooseOption([{ optionId: "a", name: "A", kind: "allow_once" }], "deny"),
		).toBeUndefined();
	});
});

describe("isVerdict", () => {
	test("only the three gate verdicts count, never a prototype key or a near miss", () => {
		expect(["allow", "ask", "deny"].every(isVerdict)).toBe(true);
		for (const junk of ["ALLOW", "toString", "", undefined, null, 1, {}]) {
			expect(isVerdict(junk)).toBe(false);
		}
	});
});
