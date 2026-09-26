/**
 * `maina statusline [install|remove|preview]` (FR-RET-1, #347).
 *
 *   maina statusline                   render the line for the host (JSON on stdin)
 *   maina statusline preview           render it for this directory, no stdin
 *   maina statusline install [--scope user|project|local] [--command <cmd>]
 *   maina statusline remove  [--scope user|project|local]
 *
 * The status line is Claude Code's `statusLine` settings key, which maina
 * owns as one managed key (the keyed JSON merge of `onboarding/json-key`):
 * install and remove keep every other byte of the user's settings, back the
 * file up once before the first write, and never replace or remove a status
 * line that is not maina's. The default scope is `local`
 * (`.claude/settings.local.json`, which Claude Code keeps out of git).
 *
 * Rendering is a port: the runtime, which owns the resident process the
 * line reports on, supplies it. The render path always prints one line and
 * exits 0; a failure prints "Maina: off".
 */

import { join } from "node:path";
import { applyFileOp, type HostFs } from "../hosts/apply";
import { globalBackupPath } from "../hosts/targets";
import {
	mergeJsonKey,
	parseJsonObject,
	removeJsonKey,
} from "../onboarding/json-key";
import { removeTopLevelKey, setTopLevelKey } from "../onboarding/json-splice";

type StatuslineScope = "user" | "project" | "local";

const SCOPES: readonly StatuslineScope[] = ["user", "project", "local"];

export type StatuslinePorts = Readonly<{
	/** The status line for the host's JSON input (may be empty). */
	render: (hostInput: string) => Promise<string>;
	readStdin: () => Promise<string>;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	fs: HostFs;
	home: string;
	cwd: string;
	/** The command the host runs for the line, unless `--command` is given. */
	command: string;
}>;

type SettingsEdit =
	| Readonly<{ kind: "write"; text: string }>
	| Readonly<{ kind: "unchanged" }>
	| Readonly<{ kind: "refused"; reason: string }>;

const KEY_NAME = "statusLine";
const KEY = [KEY_NAME] as const;

const OFF = "Maina: off";

const USAGE = `usage: maina statusline [preview [--session <id>]]
       maina statusline install [--scope user|project|local] [--command <cmd>]
       maina statusline remove [--scope user|project|local]
`;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The Claude Code settings file for `scope`. */
export function statuslineSettingsPath(
	scope: StatuslineScope,
	where: Readonly<{ home: string; cwd: string }>,
): string {
	switch (scope) {
		case "user":
			return join(where.home, ".claude", "settings.json");
		case "project":
			return join(where.cwd, ".claude", "settings.json");
		case "local":
			return join(where.cwd, ".claude", "settings.local.json");
		default: {
			const unreachable: never = scope;
			return unreachable;
		}
	}
}

/** Where the pre-maina copy of a scope's settings is kept. */
function backupPath(
	scope: StatuslineScope,
	where: Readonly<{ home: string; cwd: string }>,
	path: string,
): string {
	return scope === "user"
		? globalBackupPath(where.home, path)
		: join(
				where.cwd,
				".maina",
				"backups",
				".claude",
				scope === "local" ? "settings.local.json" : "settings.json",
			);
}

/**
 * Whether a `statusLine` value is maina's: a command that runs maina's
 * `statusline` (or exactly the command maina would install).
 */
function isMainaStatusline(value: unknown, command?: string): boolean {
	if (!isRecord(value) || typeof value.command !== "string") return false;
	const cmd = value.command.trim();
	if (cmd === "") return false;
	return (
		cmd === command?.trim() ||
		(/maina/i.test(cmd) && /\bstatusline["']?$/.test(cmd))
	);
}

function describeEntry(value: unknown): string {
	const shown =
		isRecord(value) && typeof value.command === "string"
			? value.command
			: JSON.stringify(value);
	const text = JSON.stringify(shown) ?? "";
	return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** Settings `text` (null: no file) with maina's status line running `command`. */
export function withStatusline(
	text: string | null,
	command: string,
): SettingsEdit {
	const current = text ?? "";
	const parsed = parseJsonObject(current);
	if (!parsed.ok) return { kind: "refused", reason: parsed.reason };
	const existing = parsed.value.statusLine;
	if (existing !== undefined && !isMainaStatusline(existing, command)) {
		return {
			kind: "refused",
			reason: `a status line that is not maina's is already set (${describeEntry(existing)}); remove it first`,
		};
	}
	const entry = { type: "command", command, padding: 0 };
	const merged = mergeJsonKey(current, KEY, entry);
	switch (merged.kind) {
		case "merged":
			// Splice when the file allows it, so a hand-formatted file keeps
			// every other byte; the keyed merge covers the rest.
			return {
				kind: "write",
				text: setTopLevelKey(current, KEY_NAME, entry) ?? merged.text,
			};
		case "unchanged":
			return { kind: "unchanged" };
		case "invalid":
			return { kind: "refused", reason: merged.reason };
		default: {
			const unreachable: never = merged;
			return unreachable;
		}
	}
}

/**
 * Settings `text` (null: no file) without maina's status line. `command` is
 * the one maina installs, which counts as maina's wherever it lives.
 */
export function withoutStatusline(
	text: string | null,
	command?: string,
): SettingsEdit {
	if (text === null) return { kind: "unchanged" };
	const parsed = parseJsonObject(text);
	if (!parsed.ok) return { kind: "refused", reason: parsed.reason };
	const existing = parsed.value.statusLine;
	if (existing === undefined) return { kind: "unchanged" };
	if (!isMainaStatusline(existing, command)) {
		return {
			kind: "refused",
			reason: `the status line is not maina's (${describeEntry(existing)}); left untouched`,
		};
	}
	const removed = removeJsonKey(text, KEY);
	return removed.kind === "merged"
		? { kind: "write", text: removeTopLevelKey(text, KEY_NAME) ?? removed.text }
		: removed.kind === "invalid"
			? { kind: "refused", reason: removed.reason }
			: { kind: "unchanged" };
}

type Parsed =
	| Readonly<{ kind: "render" }>
	| Readonly<{ kind: "preview"; session?: string }>
	| Readonly<{ kind: "install"; scope: StatuslineScope; command?: string }>
	| Readonly<{ kind: "remove"; scope: StatuslineScope }>
	| Readonly<{ kind: "help" }>
	| Readonly<{ kind: "usage"; message: string }>;

/** `--name value` flags; null when a flag is unknown or has no value. */
function readFlags(
	args: readonly string[],
	allowed: readonly string[],
): Readonly<Record<string, string>> | null {
	const flags: Record<string, string> = {};
	for (let i = 0; i < args.length; i += 2) {
		const name = args[i];
		const value = args[i + 1];
		if (name === undefined || !allowed.includes(name) || value === undefined) {
			return null;
		}
		flags[name] = value;
	}
	return flags;
}

function parseScope(value: string | undefined): StatuslineScope | null {
	if (value === undefined) return "local";
	return (SCOPES as readonly string[]).includes(value)
		? (value as StatuslineScope)
		: null;
}

function parseArgs(args: readonly string[]): Parsed {
	const [sub, ...rest] = args;
	switch (sub) {
		case undefined:
		case "render":
			return rest.length === 0
				? { kind: "render" }
				: { kind: "usage", message: "render takes no arguments" };
		case "help":
		case "--help":
		case "-h":
			return { kind: "help" };
		case "preview": {
			const flags = readFlags(rest, ["--session"]);
			if (flags === null)
				return { kind: "usage", message: "bad preview flags" };
			const session = flags["--session"];
			return session === undefined
				? { kind: "preview" }
				: { kind: "preview", session };
		}
		case "install":
		case "remove": {
			const allowed =
				sub === "install" ? ["--scope", "--command"] : ["--scope"];
			const flags = readFlags(rest, allowed);
			if (flags === null) return { kind: "usage", message: `bad ${sub} flags` };
			const scope = parseScope(flags["--scope"]);
			if (scope === null) {
				return { kind: "usage", message: `unknown scope ${flags["--scope"]}` };
			}
			if (sub === "remove") return { kind: "remove", scope };
			const command = flags["--command"];
			return command === undefined
				? { kind: "install", scope }
				: { kind: "install", scope, command };
		}
		default:
			return { kind: "usage", message: `unknown subcommand ${sub}` };
	}
}

async function settle<T>(run: () => Promise<T>, fallback: T): Promise<T> {
	try {
		return await run();
	} catch {
		return fallback;
	}
}

/** Prints one line, always: the first line of the render, or "Maina: off". */
async function printLine(
	ports: StatuslinePorts,
	input: () => Promise<string>,
): Promise<number> {
	const hostInput = await settle(input, "");
	const line = await settle(() => ports.render(hostInput), OFF);
	ports.stdout(`${line.split("\n", 1)[0] ?? OFF}\n`);
	return 0;
}

/** Install or remove maina's status line in the settings for `scope`. */
function editSettings(
	ports: StatuslinePorts,
	scope: StatuslineScope,
	command: string | null,
): number {
	const path = statuslineSettingsPath(scope, ports);
	const backup = backupPath(scope, ports, path);
	const text = ports.fs.read(path);
	const saved = ports.fs.read(backup);
	if (!text.ok || !saved.ok) {
		ports.stderr(
			`maina statusline: cannot read ${path}: ${text.ok ? (saved.ok ? "" : saved.error) : text.error}\n`,
		);
		return 1;
	}
	const edit =
		command === null
			? withoutStatusline(text.value, ports.command)
			: withStatusline(text.value, command);
	switch (edit.kind) {
		case "refused":
			ports.stderr(`maina statusline: ${path}: ${edit.reason}\n`);
			return 1;
		case "unchanged":
			ports.stdout(
				command === null
					? `maina status line: none in ${path}\n`
					: `maina status line: already in ${path}\n`,
			);
			return 0;
		case "write": {
			const applied = applyFileOp(
				{
					path,
					action: command === null ? "removed" : "updated",
					content: edit.text,
					...(text.value !== null && saved.value === null
						? { backup: { path: backup, content: text.value } }
						: {}),
				},
				ports.fs,
			);
			if (!applied.ok) {
				ports.stderr(`maina statusline: ${path}: ${applied.error}\n`);
				return 1;
			}
			ports.stdout(
				command === null
					? `maina status line removed from ${path}\n`
					: `maina status line installed in ${path}\n`,
			);
			return 0;
		}
		default: {
			const unreachable: never = edit;
			return unreachable;
		}
	}
}

/** Runs `maina statusline <args>`; resolves to the exit code. Never rejects. */
export async function runStatusline(
	args: readonly string[],
	ports: StatuslinePorts,
): Promise<number> {
	const parsed = parseArgs(args);
	switch (parsed.kind) {
		case "render":
			return printLine(ports, ports.readStdin);
		case "preview":
			return printLine(ports, async () =>
				JSON.stringify({ cwd: ports.cwd, session_id: parsed.session }),
			);
		case "install":
			return editSettings(ports, parsed.scope, parsed.command ?? ports.command);
		case "remove":
			return editSettings(ports, parsed.scope, null);
		case "help":
			ports.stdout(USAGE);
			return 0;
		case "usage":
			ports.stderr(`maina statusline: ${parsed.message}\n${USAGE}`);
			return 64;
		default: {
			const unreachable: never = parsed;
			return unreachable;
		}
	}
}
