/**
 * Cursor hook adapter (FR-GATE-7): `fromCursor` normalises a hook's stdin
 * into a gate, session or edit event, `toCursor` renders a result in
 * Cursor's flat wire format, and `cursorHooksConfig` generates the
 * `hooks.json` that registers maina. Pinned against the documented payloads
 * in `../__fixtures__/cursor`: every input fixture normalises and every
 * rendered output validates against the host's schema.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import type { GateDecision, GateEvent } from "../../gate";
import {
	CURSOR_ALLOW_LIST_WARNING,
	CURSOR_PRE_TOOL_ASK_WARNING,
	type CursorEvent,
	type CursorResult,
	cursorHooksConfig,
	fromCursor,
	toCursor,
} from "../cursor";

const DIR = join(import.meta.dir, "..", "__fixtures__", "cursor");

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(join(DIR, name), "utf8"));

const payload = (name: string): Readonly<Record<string, unknown>> =>
	fixture(name) as Readonly<Record<string, unknown>>;

type Entry = Readonly<{
	file: string;
	schema: string;
	event: string;
	direction: "input" | "output";
}>;

const MANIFEST = fixture("manifest.json") as Readonly<{
	fixtures: readonly Entry[];
}>;

function validator(schemaFile: string): (value: unknown) => boolean {
	const ajv = new Ajv({
		allErrors: true,
		strict: true,
		strictRequired: false,
		allowUnionTypes: true,
	});
	ajv.addKeyword({ keyword: "x-source" });
	const validate = ajv.compile(fixture(schemaFile) as object);
	return (value) => validate(value) === true;
}

const OUTPUT_SCHEMA: Readonly<Record<string, string>> = {
	preToolUse: "schemas/pre-tool-use.output.schema.json",
	beforeShellExecution: "schemas/before-shell-execution.output.schema.json",
	beforeMCPExecution: "schemas/before-mcp-execution.output.schema.json",
	postToolUse: "schemas/post-tool-use.output.schema.json",
	sessionStart: "schemas/session-start.output.schema.json",
	stop: "schemas/stop.output.schema.json",
};

const gateOf = (event: CursorEvent): GateEvent => {
	if (event.type !== "gate" && event.type !== "edit") {
		throw new Error(`expected a gate event, got ${JSON.stringify(event)}`);
	}
	return event.event;
};

const CONVERSATION = "668320d2-2fd8-4888-b33c-2a466fec86e7";

const META = {
	host: "cursor",
	sessionId: CONVERSATION,
	permissionMode: "unknown",
};

// ── fromCursor: the input fixtures ────────────────────────────────────────

describe("fromCursor", () => {
	test("normalises every input fixture to its own event", () => {
		const inputs = MANIFEST.fixtures.filter((f) => f.direction === "input");
		expect(inputs.length).toBeGreaterThan(0);
		for (const entry of inputs) {
			const event = fromCursor(entry.event, fixture(entry.file));
			expect(event.hookEvent, entry.file).toBe(entry.event);
		}
	});

	test("beforeShellExecution is a shell event in its cwd", () => {
		expect(
			fromCursor(
				"beforeShellExecution",
				fixture("before-shell-execution.input.json"),
			),
		).toEqual({
			type: "gate",
			hookEvent: "beforeShellExecution",
			tool: "Shell",
			event: {
				kind: "shell",
				input: { ...META, command: "rm -rf dist" },
				cwd: "/home/user/project",
			},
		});
	});

	test("beforeMCPExecution is an mcp event with its parsed arguments", () => {
		for (const name of [
			"before-mcp-execution.stdio.input.json",
			"before-mcp-execution.http.input.json",
		]) {
			const event = fromCursor("beforeMCPExecution", fixture(name));
			expect(event.type, name).toBe("gate");
			expect(gateOf(event), name).toEqual({
				kind: "mcp",
				input: {
					...META,
					server: "linear",
					tool: "create_issue",
					arguments: { title: "Flaky test" },
				},
				cwd: "/home/user/project",
			});
		}
	});

	test("beforeMCPExecution with arguments that are not a JSON object is malformed", () => {
		const bad = {
			...payload("before-mcp-execution.stdio.input.json"),
			tool_input: "{not json",
		};
		expect(fromCursor("beforeMCPExecution", bad).type).toBe("malformed");
	});

	test("preToolUse Write is a file.write event with its content", () => {
		const write = {
			...payload("pre-tool-use.write.input.json"),
			tool_input: { file_path: "/home/user/project/notes.txt", content: "hi" },
		};
		expect(fromCursor("preToolUse", write)).toEqual({
			type: "gate",
			hookEvent: "preToolUse",
			tool: "Write",
			event: {
				kind: "file.write",
				input: {
					...META,
					path: "/home/user/project/notes.txt",
					content: "hi",
				},
				cwd: "/home/user/project",
			},
		});
	});

	test("preToolUse Write without a path (the documented payload) is malformed, so it asks", () => {
		// Cursor documents no Write tool_input fields, so the fixture's is empty.
		const event = fromCursor(
			"preToolUse",
			fixture("pre-tool-use.write.input.json"),
		);
		expect(event).toEqual({
			type: "malformed",
			hookEvent: "preToolUse",
			reason: "Write without a path",
		});
	});

	test("preToolUse Delete writes, Read and Grep read", () => {
		const pre = (tool: string, toolInput: Record<string, unknown>) => ({
			...payload("pre-tool-use.shell.input.json"),
			tool_name: tool,
			tool_input: toolInput,
		});
		expect(
			gateOf(fromCursor("preToolUse", pre("Delete", { path: "a.ts" }))),
		).toMatchObject({ kind: "file.write", input: { path: "a.ts" } });
		expect(
			gateOf(fromCursor("preToolUse", pre("Read", { file_path: "/etc/x" }))),
		).toMatchObject({ kind: "file.read.outside", input: { path: "/etc/x" } });
		expect(
			gateOf(fromCursor("preToolUse", pre("Grep", { pattern: "x" }))),
		).toMatchObject({
			kind: "file.read.outside",
			input: { path: "/home/user/project" },
		});
	});

	test("preToolUse leaves Shell and MCP tools to their own hooks, where ask is enforced", () => {
		expect(
			fromCursor("preToolUse", fixture("pre-tool-use.shell.input.json")),
		).toMatchObject({ type: "ignored", hookEvent: "preToolUse" });
		const mcp = {
			...payload("pre-tool-use.shell.input.json"),
			tool_name: "MCP:create_issue",
			tool_input: {},
		};
		expect(fromCursor("preToolUse", mcp).type).toBe("ignored");
	});

	test("afterFileEdit is a post-action edit of its file", () => {
		expect(
			fromCursor("afterFileEdit", fixture("after-file-edit.input.json")),
		).toEqual({
			type: "edit",
			hookEvent: "afterFileEdit",
			event: {
				kind: "action.post",
				input: {
					host: "cursor",
					sessionId: CONVERSATION,
					action: { kind: "file.edit", path: "/home/user/project/src/app.ts" },
				},
				cwd: "/home/user/project",
			},
		});
	});

	test("sessionStart and stop are session events keyed by the conversation", () => {
		expect(
			fromCursor("sessionStart", fixture("session-start.input.json")),
		).toEqual({
			type: "session",
			hookEvent: "sessionStart",
			event: {
				kind: "session.start",
				sessionId: CONVERSATION,
				cwd: "/home/user/project",
			},
		});
		expect(fromCursor("stop", fixture("stop.input.json"))).toEqual({
			type: "session",
			hookEvent: "stop",
			event: {
				kind: "session.stop",
				sessionId: CONVERSATION,
				cwd: "/home/user/project",
			},
		});
	});

	test("sessionStart is keyed by conversation_id, the id every other hook carries", () => {
		// Gate, edit and stop payloads name the session only by conversation_id,
		// so sessionStart must use it too or its summary reads another session.
		const start = {
			...payload("session-start.input.json"),
			session_id: "a-different-session-id",
		};
		expect(fromCursor("sessionStart", start)).toMatchObject({
			type: "session",
			event: { sessionId: CONVERSATION },
		});
		const { conversation_id: _, ...onlySession } = payload(
			"session-start.input.json",
		);
		expect(fromCursor("sessionStart", onlySession)).toMatchObject({
			type: "session",
			event: { sessionId: CONVERSATION },
		});
	});

	test("postToolUse is not gated", () => {
		expect(
			fromCursor("postToolUse", fixture("post-tool-use.input.json")).type,
		).toBe("ignored");
	});

	test("a payload for another event, or none at all, is malformed", () => {
		expect(
			fromCursor("preToolUse", fixture("before-shell-execution.input.json")),
		).toEqual({
			type: "malformed",
			hookEvent: "preToolUse",
			reason: "a beforeShellExecution payload for a preToolUse hook",
		});
		expect(fromCursor("beforeShellExecution", undefined)).toMatchObject({
			type: "malformed",
			hookEvent: "beforeShellExecution",
		});
		const noCommand = {
			...payload("before-shell-execution.input.json"),
			command: "",
		};
		expect(fromCursor("beforeShellExecution", noCommand).type).toBe(
			"malformed",
		);
	});
});

// ── toCursor ────────────────────────────────────────────────────────────────

const ALLOW: GateDecision = {
	verdict: "allow",
	reason: "no rule matched",
	decisionIds: [],
	degraded: false,
};
const ASK: GateDecision = {
	verdict: "ask",
	reason: "recursive delete needs confirmation",
	decisionIds: [],
	degraded: false,
};
const DENY: GateDecision = {
	verdict: "deny",
	reason: "destructive operation outside policy",
	decisionIds: [],
	degraded: false,
};

const rendered = (result: CursorResult): unknown =>
	JSON.parse(toCursor(result).stdout);

describe("toCursor", () => {
	const GATES = ["preToolUse", "beforeShellExecution", "beforeMCPExecution"];

	test("emits { permission, user_message, agent_message } on every gate event", () => {
		for (const hookEvent of GATES) {
			expect(rendered({ hookEvent, decision: ASK }), hookEvent).toEqual({
				permission: "ask",
				user_message: "maina: recursive delete needs confirmation",
				agent_message:
					"maina asked the user to confirm this action: recursive delete needs confirmation",
			});
			expect(rendered({ hookEvent, decision: DENY }), hookEvent).toEqual({
				permission: "deny",
				user_message: "maina: destructive operation outside policy",
				agent_message:
					"maina blocked this action: destructive operation outside policy",
			});
		}
	});

	test("an allow reproduces the documented allow output byte for byte", () => {
		const out = toCursor({ hookEvent: "preToolUse", decision: ALLOW });
		expect(out.exitCode).toBe(0);
		expect(JSON.parse(out.stdout)).toEqual(
			fixture("pre-tool-use.allow.output.json"),
		);
		expect(out.stderr).toBe("");
	});

	test("a deny also exits 2 (Cursor's block) with the reason on stderr", () => {
		for (const hookEvent of GATES) {
			const out = toCursor({ hookEvent, decision: DENY });
			expect(out.exitCode, hookEvent).toBe(2);
			expect(out.stderr, hookEvent).toBe(
				"destructive operation outside policy\n",
			);
		}
	});

	test("a gate event maina ignores answers allow, which never skips Cursor's own approval", () => {
		// A permission hook must print a `permission`; `{}` fails Cursor's schema
		// and, with failClosed, would block every tool maina has no opinion on.
		for (const hookEvent of GATES) {
			expect(rendered({ hookEvent }), hookEvent).toEqual({
				permission: "allow",
			});
		}
	});

	test("session start and post-tool carry context; stop's deny is a follow-up", () => {
		expect(
			rendered({ hookEvent: "sessionStart", context: "maina guardrails" }),
		).toEqual({ additional_context: "maina guardrails" });
		expect(rendered({ hookEvent: "sessionStart" })).toEqual({});
		expect(
			rendered({ hookEvent: "postToolUse", context: "1 finding" }),
		).toEqual({ additional_context: "1 finding" });
		expect(rendered({ hookEvent: "stop", decision: DENY })).toEqual({
			followup_message: "destructive operation outside policy",
		});
		// Cursor's stop output has no field for a message to the user.
		const summary = toCursor({ hookEvent: "stop", context: "3 gated" });
		expect(JSON.parse(summary.stdout)).toEqual({});
		expect(summary.exitCode).toBe(0);
		expect(rendered({ hookEvent: "afterFileEdit" })).toEqual({});
		expect(rendered({ hookEvent: "beforeReadFile" })).toEqual({});
	});

	test("every rendered output validates against the host's schema", () => {
		const results: readonly CursorResult[] = [
			...GATES.flatMap((hookEvent) => [
				{ hookEvent },
				{ hookEvent, decision: ALLOW },
				{ hookEvent, decision: ASK },
				{ hookEvent, decision: DENY },
			]),
			{ hookEvent: "sessionStart" },
			{ hookEvent: "sessionStart", context: "ctx" },
			{ hookEvent: "postToolUse" },
			{ hookEvent: "postToolUse", context: "ctx" },
			{ hookEvent: "stop" },
			{ hookEvent: "stop", context: "ctx" },
			{ hookEvent: "stop", decision: DENY },
		];
		for (const result of results) {
			const schema = OUTPUT_SCHEMA[result.hookEvent];
			if (schema === undefined) throw new Error(result.hookEvent);
			const valid = validator(schema)(rendered(result));
			expect(valid, JSON.stringify(result)).toBe(true);
		}
	});

	test("known issue: Cursor's allow-list overrides a hook's ask, so an ask warns", () => {
		// forum.cursor.com/t/144244: a command on the user's allow-list runs
		// without a prompt even when beforeShellExecution answers `ask` (and one
		// off the list still prompts on `allow`). A deny still blocks. Adapters
		// never decide, so the ask stands and a warning goes to the hook log.
		for (const hookEvent of ["beforeShellExecution", "beforeMCPExecution"]) {
			const out = toCursor({ hookEvent, decision: ASK });
			expect(out.exitCode, hookEvent).toBe(0);
			expect(out.stderr, hookEvent).toBe(`${CURSOR_ALLOW_LIST_WARNING}\n`);
		}
		expect(CURSOR_ALLOW_LIST_WARNING).toContain("allow-list");
		expect(toCursor({ hookEvent: "preToolUse", decision: ASK }).stderr).toBe(
			`${CURSOR_PRE_TOOL_ASK_WARNING}\n`,
		);
		expect(
			toCursor({ hookEvent: "beforeShellExecution", decision: DENY }).stderr,
		).not.toContain(CURSOR_ALLOW_LIST_WARNING);
	});
});

// ── cursorHooksConfig ─────────────────────────────────────────────────────

describe("cursorHooksConfig", () => {
	const { config, warnings } = cursorHooksConfig("./launch.sh hook");

	test("registers the six hooks maina handles, each on its own event", () => {
		expect(config.version).toBe(1);
		expect(Object.keys(config.hooks).sort()).toEqual(
			[
				"afterFileEdit",
				"beforeMCPExecution",
				"beforeShellExecution",
				"preToolUse",
				"sessionStart",
				"stop",
			].sort(),
		);
		for (const [event, entries] of Object.entries(config.hooks)) {
			expect(entries.map((e) => e.command)).toEqual([
				`./launch.sh hook ${event}`,
			]);
		}
	});

	test("sets failClosed on every permission hook, so a crash or timeout blocks", () => {
		for (const event of [
			"preToolUse",
			"beforeShellExecution",
			"beforeMCPExecution",
		]) {
			expect(config.hooks[event]?.[0]?.failClosed, event).toBe(true);
		}
		// A crashed session or edit hook must not wedge the session.
		for (const event of ["sessionStart", "afterFileEdit", "stop"]) {
			expect(config.hooks[event]?.[0]?.failClosed, event).toBeUndefined();
		}
	});

	test("warns about the known allow-list override", () => {
		expect(warnings).toContain(CURSOR_ALLOW_LIST_WARNING);
	});
});
