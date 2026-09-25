/**
 * Claude Code hook adapter (FR-GATE-7): `fromClaude` normalises a hook's
 * stdin into a gate or session event, `toClaude` renders a result in Claude
 * Code's wire format. Pinned against the captured and documented payloads in
 * `../__fixtures__/claude-code`: every input fixture normalises, every output
 * fixture is reproduced byte for byte, and every rendered output validates
 * against the host's schema.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import type { GateDecision, GateEvent } from "../../gate";
import {
	type ClaudeEvent,
	type ClaudeResult,
	fromClaude,
	toClaude,
} from "../claude-code";

const DIR = join(import.meta.dir, "..", "__fixtures__", "claude-code");

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(join(DIR, name), "utf8"));

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
	PreToolUse: "schemas/pre-tool-use.output.schema.json",
	PermissionRequest: "schemas/permission-request.output.schema.json",
	PostToolUse: "schemas/post-tool-use.output.schema.json",
	SessionStart: "schemas/session-start.output.schema.json",
	Stop: "schemas/stop.output.schema.json",
};

const gateOf = (event: ClaudeEvent): GateEvent => {
	if (event.type !== "gate") {
		throw new Error(`expected a gate event, got ${JSON.stringify(event)}`);
	}
	return event.event;
};

const META = {
	host: "claude-code",
	sessionId: "68888356-74b4-4638-9a07-3ca70c36e753",
	permissionMode: "accept_edits",
};

// ── fromClaude: the input fixtures ────────────────────────────────────────

describe("fromClaude", () => {
	test("normalises every input fixture (none is malformed)", () => {
		const inputs = MANIFEST.fixtures.filter((f) => f.direction === "input");
		expect(inputs.length).toBeGreaterThan(0);
		for (const entry of inputs) {
			const event = fromClaude(fixture(entry.file));
			expect(event.type, entry.file).not.toBe("malformed");
			expect(event.hookEvent, entry.file).toBe(entry.event);
		}
	});

	test("PreToolUse Bash is a shell event", () => {
		const event = fromClaude(fixture("pre-tool-use.bash.input.json"));
		expect(event).toEqual({
			type: "gate",
			hookEvent: "PreToolUse",
			tool: "Bash",
			event: {
				kind: "shell",
				input: { ...META, command: "echo hello" },
				cwd: "/home/user/project",
			},
		});
	});

	test("PreToolUse Write is a file.write event with its content", () => {
		const event = gateOf(fromClaude(fixture("pre-tool-use.write.input.json")));
		expect(event).toEqual({
			kind: "file.write",
			input: {
				...META,
				path: "/home/user/project/notes.txt",
				content: "hi",
			},
			cwd: "/home/user/project",
		});
	});

	test("PreToolUse on an MCP tool is an mcp event named by its server", () => {
		const event = gateOf(fromClaude(fixture("pre-tool-use.mcp.input.json")));
		expect(event).toEqual({
			kind: "mcp",
			input: {
				host: "claude-code",
				sessionId: "02124521-44af-4030-bf39-3d7706703f13",
				permissionMode: "default",
				server: "echo",
				tool: "echo",
				arguments: { text: "ping" },
			},
			cwd: "/home/user/project",
		});
	});

	test("PermissionRequest is gated like PreToolUse", () => {
		const event = fromClaude(fixture("permission-request.bash.input.json"));
		expect(event.type).toBe("gate");
		expect(event.hookEvent).toBe("PermissionRequest");
		expect(gateOf(event).input.command).toBe("touch made-by-hook.txt");
		expect(gateOf(event).input.permissionMode).toBe("default");
	});

	test("SessionStart and Stop are session events", () => {
		expect(fromClaude(fixture("session-start.startup.input.json"))).toEqual({
			type: "session",
			hookEvent: "SessionStart",
			event: {
				kind: "session.start",
				sessionId: META.sessionId,
				cwd: "/home/user/project",
				source: "startup",
			},
		});
		expect(fromClaude(fixture("stop.input.json"))).toEqual({
			type: "session",
			hookEvent: "Stop",
			event: {
				kind: "session.stop",
				sessionId: META.sessionId,
				cwd: "/home/user/project",
			},
		});
	});

	test("PostToolUse is not gated", () => {
		for (const name of [
			"post-tool-use.bash.input.json",
			"post-tool-use.write.input.json",
			"post-tool-use.mcp.input.json",
		]) {
			expect(fromClaude(fixture(name)).type, name).toBe("ignored");
		}
	});

	const pre = (tool: string, toolInput: Record<string, unknown>) => ({
		session_id: "s1",
		cwd: "/home/user/project",
		hook_event_name: "PreToolUse",
		permission_mode: "bypassPermissions",
		tool_name: tool,
		tool_input: toolInput,
	});

	test("edits carry the text they write; reads carry their path", () => {
		const base = {
			host: "claude-code",
			sessionId: "s1",
			permissionMode: "bypass",
		};
		expect(
			gateOf(
				fromClaude(
					pre("Edit", { file_path: "a.ts", old_string: "x", new_string: "y" }),
				),
			).input,
		).toEqual({ ...base, path: "a.ts", content: "y" });
		expect(
			gateOf(
				fromClaude(
					pre("MultiEdit", {
						file_path: "a.ts",
						edits: [
							{ old_string: "a", new_string: "b" },
							{ old_string: "c", new_string: "d" },
						],
					}),
				),
			).input,
		).toEqual({ ...base, path: "a.ts", content: "b\nd" });
		expect(
			gateOf(
				fromClaude(
					pre("NotebookEdit", { notebook_path: "n.ipynb", new_source: "1" }),
				),
			),
		).toMatchObject({
			kind: "file.write",
			input: { path: "n.ipynb", content: "1" },
		});
		expect(
			gateOf(fromClaude(pre("Read", { file_path: "/etc/hosts" }))),
		).toMatchObject({
			kind: "file.read.outside",
			input: { path: "/etc/hosts" },
		});
		// A search with no path searches the working directory.
		expect(gateOf(fromClaude(pre("Grep", { pattern: "x" })))).toMatchObject({
			kind: "file.read.outside",
			input: { path: "/home/user/project" },
		});
		expect(
			gateOf(fromClaude(pre("Glob", { pattern: "*", path: "~/.ssh" }))),
		).toMatchObject({ kind: "file.read.outside", input: { path: "~/.ssh" } });
		expect(
			gateOf(
				fromClaude(pre("WebFetch", { url: "https://x.dev", prompt: "p" })),
			),
		).toMatchObject({ kind: "network", input: { url: "https://x.dev" } });
	});

	test("a Grep glob narrows what it reads, so a secret glob reads as the secret", () => {
		const path = (toolInput: Record<string, unknown>) =>
			gateOf(fromClaude(pre("Grep", { pattern: "KEY", ...toolInput }))).input
				.path;
		expect(path({ glob: ".env" })).toBe("/home/user/project/.env");
		// Wildcards are dropped: `.env*` matches `.env`, `**/*.pem` any `.pem`.
		expect(path({ glob: ".env*" })).toBe("/home/user/project/.env");
		expect(path({ glob: "**/*.pem", path: "/srv/app/" })).toBe("/srv/app/.pem");
		// A glob that is all wildcards reads the whole directory.
		expect(path({ glob: "**/*" })).toBe("/home/user/project");
	});

	test("an MCP tool without mcp_server is split from its name", () => {
		expect(
			gateOf(fromClaude(pre("mcp__github__get_issue", { number: 1 }))),
		).toMatchObject({
			kind: "mcp",
			input: { server: "github", tool: "get_issue", arguments: { number: 1 } },
		});
	});

	test("tools maina does not gate are ignored, not allowed", () => {
		expect(fromClaude(pre("TodoWrite", { todos: [] })).type).toBe("ignored");
		expect(fromClaude(pre("Task", { prompt: "x" })).type).toBe("ignored");
	});

	test("unknown permission modes normalise to unknown", () => {
		expect(
			gateOf(
				fromClaude({
					...pre("Bash", { command: "ls" }),
					permission_mode: "dontAsk",
				}),
			).input.permissionMode,
		).toBe("unknown");
	});

	test("malformed input is malformed, never an event", () => {
		const bad: readonly unknown[] = [
			null,
			"PreToolUse",
			[],
			{},
			{ hook_event_name: "PreToolUse" },
			{ ...pre("Bash", {}), tool_input: "rm -rf /" },
			fixture("invalid/pre-tool-use.bash-without-command.input.json"),
			pre("Write", { content: "no path" }),
			pre("mcp__", {}),
			{ ...pre("Bash", { command: "ls" }), hook_event_name: "Nope" },
		];
		for (const input of bad) {
			expect(fromClaude(input).type, JSON.stringify(input)).toBe("malformed");
		}
	});

	test("the hook event the host was configured for must match the input", () => {
		const input = fixture("pre-tool-use.bash.input.json");
		expect(fromClaude(input, "PreToolUse").type).toBe("gate");
		const mismatch = fromClaude(input, "Stop");
		expect(mismatch.type).toBe("malformed");
		expect(mismatch.hookEvent).toBe("Stop");
		// With no event in the payload, the configured one names the output.
		expect(fromClaude("garbage", "PreToolUse").hookEvent).toBe("PreToolUse");
	});
});

// ── toClaude: the output fixtures ─────────────────────────────────────────

const decision = (verdict: GateDecision["verdict"], reason: string) => ({
	verdict,
	reason,
	decisionIds: [],
	degraded: false,
});

/** The result each output fixture is the rendering of. */
const RESULTS: Readonly<Record<string, ClaudeResult>> = {
	"pre-tool-use.allow.output.json": {
		hookEvent: "PreToolUse",
		decision: decision("allow", "Allowed by maina policy"),
	},
	"pre-tool-use.deny.output.json": {
		hookEvent: "PreToolUse",
		decision: decision("deny", "Blocked by maina policy: destructive command"),
	},
	"pre-tool-use.ask.output.json": {
		hookEvent: "PreToolUse",
		decision: decision(
			"ask",
			"maina: writes outside the workspace need confirmation",
		),
	},
	"permission-request.deny.output.json": {
		hookEvent: "PermissionRequest",
		decision: decision("deny", "Blocked by maina policy"),
	},
	"session-start.context.output.json": {
		hookEvent: "SessionStart",
		context: "maina guardrails active for this repository.",
	},
	"post-tool-use.context.output.json": {
		hookEvent: "PostToolUse",
		context: "maina: 1 finding on the edited lines.",
	},
	"stop.allow.output.json": { hookEvent: "Stop" },
	"stop.block.output.json": {
		hookEvent: "Stop",
		decision: decision(
			"deny",
			"maina verify failed on changed lines; fix before finishing.",
		),
	},
};

describe("toClaude", () => {
	test("reproduces every output fixture", () => {
		const outputs = MANIFEST.fixtures.filter((f) => f.direction === "output");
		expect(outputs.map((f) => f.file).sort()).toEqual(
			Object.keys(RESULTS).sort(),
		);
		for (const entry of outputs) {
			const result = RESULTS[entry.file];
			if (result === undefined) throw new Error(`no result for ${entry.file}`);
			const out = toClaude(result);
			expect(JSON.parse(out.stdout), entry.file).toEqual(fixture(entry.file));
			expect(out.stdout.endsWith("\n"), entry.file).toBe(true);
		}
	});

	test("every verdict renders valid output for its event", () => {
		for (const verdict of ["allow", "ask", "deny"] as const) {
			for (const hookEvent of [
				"PreToolUse",
				"PermissionRequest",
				"Stop",
			] as const) {
				const out = toClaude({ hookEvent, decision: decision(verdict, "why") });
				const schema = OUTPUT_SCHEMA[hookEvent] ?? "";
				expect(
					validator(schema)(JSON.parse(out.stdout)),
					`${hookEvent} ${verdict}`,
				).toBe(true);
			}
		}
		for (const hookEvent of ["SessionStart", "PostToolUse", "Stop"] as const) {
			for (const context of [undefined, "note"]) {
				const out = toClaude({ hookEvent, context });
				const schema = OUTPUT_SCHEMA[hookEvent] ?? "";
				expect(validator(schema)(JSON.parse(out.stdout)), hookEvent).toBe(true);
			}
		}
	});

	test("a PreToolUse deny also exits 2 with the reason on stderr", () => {
		const out = toClaude({
			hookEvent: "PreToolUse",
			decision: decision("deny", "fs.delete.outside is denied"),
		});
		expect(out.exitCode).toBe(2);
		expect(out.stderr).toBe("fs.delete.outside is denied\n");
	});

	test("a PermissionRequest deny also exits 2 with the reason on stderr", () => {
		const out = toClaude({
			hookEvent: "PermissionRequest",
			decision: decision("deny", "no"),
		});
		expect(out.exitCode).toBe(2);
		expect(out.stderr).toBe("no\n");
	});

	test("allow and ask exit 0 with nothing on stderr", () => {
		for (const verdict of ["allow", "ask"] as const) {
			const out = toClaude({
				hookEvent: "PreToolUse",
				decision: decision(verdict, "why"),
			});
			expect(out.exitCode).toBe(0);
			expect(out.stderr).toBe("");
		}
	});

	test("a PermissionRequest ask leaves the host's dialog in place", () => {
		const out = toClaude({
			hookEvent: "PermissionRequest",
			decision: decision("ask", "confirm"),
		});
		expect(JSON.parse(out.stdout)).toEqual({});
		expect(out.exitCode).toBe(0);
	});

	test("the session summary is shown to the user on Stop", () => {
		const out = toClaude({
			hookEvent: "Stop",
			context: "maina session: 1 blocked, 0 asked, 3 allowed",
		});
		expect(JSON.parse(out.stdout)).toEqual({
			systemMessage: "maina session: 1 blocked, 0 asked, 3 allowed",
		});
		expect(out.exitCode).toBe(0);
	});

	test("an event maina has nothing to say about prints {}", () => {
		expect(toClaude({ hookEvent: "PostToolUse" }).stdout).toBe("{}\n");
		expect(toClaude({ hookEvent: "SessionStart" }).stdout).toBe("{}\n");
		expect(toClaude({ hookEvent: "Notification" }).stdout).toBe("{}\n");
	});
});
