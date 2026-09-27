/**
 * Every worker's gate integration (FR-HAR-2, FR-SBX-5): what goes into a
 * run's worktree so the gate keeps seeing the agent's calls, and the
 * sandbox options that stop the agent taking it out again.
 *
 * - Claude Code: its `PreToolUse` hook (`claude-sdk-hook.ts`), which runs
 *   before every tool whatever the agent's permission mode.
 * - An ACP worker (Codex, Cursor, Gemini, OpenCode): the gate is the ACP
 *   bridge, which answers `session/request_permission` from the harness,
 *   outside the sandbox. It sees a call only if the agent asks, and each
 *   agent reads from the worktree a permission config that can tell it not
 *   to (Codex `approval_policy`, a Cursor allow list, Gemini `autoAccept`
 *   or YOLO mode, OpenCode `permission`). The install pins that config to
 *   asking, keeping the rest of a repo's own settings, and records the
 *   run's policy beside the bridge's permission log, outside the worktree.
 *   What a repo ships beside that config and the agent loads over it
 *   (OpenCode markdown agents and modes with their own `permission`,
 *   plugins that answer its asks, a second `.jsonc` config; Gemini
 *   workspace policy files with `allow` rules) is there before the run, so
 *   the write-deny below cannot stop it: the install moves it aside, whole,
 *   into a quarantine inside the same guarded directory, and the uninstall
 *   puts it back. Moving is chosen over refusing the run so a repo that
 *   ships such files can still be worked on, gated.
 *
 * The returned sandbox denies writes to the config's directory, the policy
 * record and the log, so a prompt-injected agent cannot switch its own
 * asking off, plant another config beside the pinned one, or rewrite the
 * gate's record. A repo's existing config is backed up before the first
 * write and restored by `uninstallWorkerGate`, as is what was moved aside;
 * neither ever overwrites a file that has since taken its place.
 *
 * `GATE_CONFIGS` and `pinGateConfig` are pure; the install and uninstall
 * are the imperative shell.
 */

import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Result } from "@mainahq/core";
import type { SandboxOptions } from "../sandbox/port";
import type { WorkerName, WorkerSpec } from "../workers/spec";
import {
	type ClaudeHookOptions,
	installClaudePreToolUse,
	type PermissionSetupError,
	uninstallClaudePreToolUse,
} from "./claude-sdk-hook";

type AcpWorker = Exclude<WorkerName, "claude">;

type Json = Readonly<Record<string, unknown>>;

/** Where an ACP worker reads its project permission config in a worktree. */
type GateConfig = Readonly<{
	/** The agent's project config directory, relative to the worktree. */
	dir: string;
	/** The config file inside `dir`. */
	file: string;
	/**
	 * Entries a repo can ship in `dir` that the agent loads over `file` and
	 * that can skip the ask; the install moves each aside.
	 */
	overrides: readonly string[];
}>;

export const GATE_CONFIGS: Readonly<Record<AcpWorker, GateConfig>> = {
	// Project-scoped Codex config; `untrusted` asks before anything that is
	// not a known-safe read.
	codex: { dir: ".codex", file: "config.toml", overrides: [] },
	// The Cursor CLI's project config (permissions only): an allow entry
	// runs without asking.
	cursor: { dir: ".cursor", file: "cli.json", overrides: [] },
	// Gemini CLI project settings: `autoAccept` skips the ask for tools it
	// deems safe, YOLO mode for everything. It also loads the workspace's
	// policy files, whose `allow` rules skip it for the tools they match.
	gemini: { dir: ".gemini", file: "settings.json", overrides: ["policies"] },
	// OpenCode merges `.opencode/opencode.json` over the root config, and
	// loads plugins (which can answer its asks) from the same directory,
	// as well as markdown agents and modes whose own `permission` wins over
	// the global one, and an `opencode.jsonc` merged beside the `.json`.
	opencode: {
		dir: ".opencode",
		file: "opencode.json",
		overrides: [
			"agent",
			"agents",
			"mode",
			"modes",
			"plugin",
			"plugins",
			"opencode.jsonc",
		],
	},
};

/** OpenCode's asking permissions, globally and for every agent. */
const OPENCODE_ASK: Json = { edit: "ask", bash: "ask", webfetch: "ask" };

/** JSON configs: the keys pinned over whatever the repo has. */
const JSON_PINS: Readonly<Record<Exclude<AcpWorker, "codex">, Json>> = {
	cursor: { permissions: { allow: [] } },
	// Each of these skips the ask: `auto_edit` for edits, an allow list or
	// a policy file's `allow` rule for the tools it names, YOLO for all.
	gemini: {
		general: { defaultApprovalMode: "default" },
		tools: { autoAccept: false, allowed: [] },
		security: { disableYoloMode: true },
		policyPaths: [],
	},
	// A plugin the config lists can answer `permission.ask` itself.
	opencode: { permission: OPENCODE_ASK, plugin: [] },
};

/** JSON configs: what a missing key starts as, under the repo's own. */
const JSON_DEFAULTS: Readonly<Record<Exclude<AcpWorker, "codex">, Json>> = {
	cursor: { permissions: { allow: [], deny: [] } },
	gemini: {},
	opencode: {},
};

const CODEX_PIN = 'approval_policy = "untrusted"';

/**
 * Top-level Codex keys that would choose an approval policy other than the
 * pin, bare or quoted (`"approval_policy" = ...` is the same key in TOML).
 */
const CODEX_UNPINNED = /^\s*(["']?)(approval_policy|profile)\1\s*=/;

/**
 * A TOML table header (`[name]`, `[[name]]`, maybe a trailing comment), as
 * opposed to a line of a multi-line array value that happens to open with
 * `[`: the top level ends at the first header.
 */
const TOML_TABLE = /^\s*\[\[?[^[\],=]+\]\]?\s*(#.*)?$/;

const fail = (
	code: PermissionSetupError["code"],
	message: string,
): Result<never, PermissionSetupError> => ({
	ok: false,
	error: { code, message },
});

const isJson = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** `over` laid onto `base`, objects merged key by key, anything else replaced. */
function merge(base: Json, over: Json): Json {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(over)) {
		const current = out[key];
		out[key] = isJson(current) && isJson(value) ? merge(current, value) : value;
	}
	return out;
}

/**
 * OpenCode merges an agent's own `permission` over the global one, the
 * agent's rules winning (`agent.<name>`, and the older `mode.<name>`), so
 * each is pinned to asking as well; its other rules stay.
 */
function pinOpencodeAgents(config: Json): Json {
	const out: Record<string, unknown> = { ...config };
	for (const key of ["agent", "mode"] as const) {
		const agents = config[key];
		if (!isJson(agents)) continue;
		const pinned: Record<string, unknown> = {};
		for (const [name, agent] of Object.entries(agents)) {
			if (!isJson(agent)) {
				pinned[name] = agent;
				continue;
			}
			const own = isJson(agent.permission) ? agent.permission : {};
			pinned[name] = { ...agent, permission: merge(own, OPENCODE_ASK) };
		}
		out[key] = pinned;
	}
	return out;
}

function pinCodex(existing: string | undefined): string {
	const lines = existing === undefined ? [] : existing.split("\n");
	const firstTable = lines.findIndex((line) => TOML_TABLE.test(line));
	const split = firstTable === -1 ? lines.length : firstTable;
	const topLevel = lines
		.slice(0, split)
		.filter((line) => !CODEX_UNPINNED.test(line));
	const kept = [...topLevel, ...lines.slice(split)].join("\n").trim();
	return kept === "" ? `${CODEX_PIN}\n` : `${CODEX_PIN}\n${kept}\n`;
}

/**
 * The worker's config with its approvals pinned to asking. `existing` is
 * the repo's own file, or undefined when there is none.
 */
export function pinGateConfig(
	worker: AcpWorker,
	existing: string | undefined,
): Result<string, PermissionSetupError> {
	if (worker === "codex") return { ok: true, value: pinCodex(existing) };
	let repo: Json = {};
	if (existing !== undefined) {
		try {
			const parsed: unknown = JSON.parse(existing);
			if (!isJson(parsed)) {
				return fail("invalid_settings", "the config is not a JSON object");
			}
			repo = parsed;
		} catch (e) {
			return fail(
				"invalid_settings",
				`the config is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}
	const base = merge(JSON_DEFAULTS[worker], repo);
	const pinned = merge(
		worker === "opencode" ? pinOpencodeAgents(base) : base,
		JSON_PINS[worker],
	);
	return { ok: true, value: `${JSON.stringify(pinned, null, 2)}\n` };
}

// ── installing it ───────────────────────────────────────────────────────────

export type WorkerGateInstall = Readonly<{
	/** The directory in the worktree the agent may no longer write. */
	configDir: string;
	/** The config the install wrote inside it. */
	configPath: string;
	/**
	 * Inside `configDir`: where the repo's overrides of that config were
	 * moved aside (it exists only when there were some).
	 */
	quarantineDir: string;
	/** The run's policy, recorded outside the worktree. */
	policyPath: string;
	/** Where the gate's permission records go (JSON lines). */
	logPath: string;
	/** `sandbox` with the gate's files protected. */
	sandbox: SandboxOptions;
}>;

const backupOf = (configPath: string): string => `${configPath}.maina-backup`;

/**
 * Inside the guarded config directory, and matching none of the globs the
 * agents load from (`{agent,agents,mode,modes}/**` and `{plugin,plugins}/*`
 * are relative to `.opencode`, `policies/*.toml` to `.gemini`).
 */
const QUARANTINE = ".maina-quarantine";
/** What maina moved into the quarantine, so only that is ever put back. */
const MOVED = "moved.json";
const quarantineOf = (configDir: string): string => join(configDir, QUARANTINE);
/** Beside a config maina created (the repo had none), so uninstall removes it. */
const createdMarkerOf = (configPath: string): string =>
	`${configPath}.maina-created`;

/** The ACP agent a worker drives, or undefined for Claude and headless ones. */
function acpAgent(worker: WorkerSpec): AcpWorker | undefined {
	return worker.protocol === "acp" && Object.hasOwn(GATE_CONFIGS, worker.name)
		? (worker.name as AcpWorker)
		: undefined;
}

const isClaude = (worker: WorkerSpec): boolean =>
	worker.name === "claude" || worker.name === "headless:claude";

function readText(path: string): string | undefined {
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** Anything at `path`, a dangling symlink included (`existsSync` follows it). */
function present(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * The entries maina recorded moving aside, kept to the worker's own
 * override names so a record can never point outside the directory.
 */
function readMoved(
	manifestPath: string,
	overrides: readonly string[],
): Result<string[], PermissionSetupError> {
	if (!present(manifestPath)) return { ok: true, value: [] };
	try {
		const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (!Array.isArray(parsed)) {
			return fail("invalid_settings", `${manifestPath}: not a JSON array`);
		}
		return {
			ok: true,
			value: overrides.filter((entry) => parsed.includes(entry)),
		};
	} catch (e) {
		return fail(
			"invalid_settings",
			`${manifestPath}: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}

/**
 * Moves each of the repo's overrides out of `configDir` into its
 * quarantine, recording each move as it happens so an install that stops
 * part way is still undone by the uninstall. One that is already there,
 * moved by an earlier install or the repo's own, stops the install
 * (fail closed) rather than being overwritten.
 */
function quarantineOverrides(
	configDir: string,
	overrides: readonly string[],
): Result<void, PermissionSetupError> {
	const quarantineDir = quarantineOf(configDir);
	const manifestPath = join(quarantineDir, MOVED);
	const recorded = readMoved(manifestPath, overrides);
	if (!recorded.ok) return recorded;
	const moved = recorded.value;
	for (const entry of overrides) {
		const from = join(configDir, entry);
		if (!present(from)) continue;
		const to = join(quarantineDir, entry);
		if (present(to)) {
			return fail(
				"invalid_settings",
				`${from} would skip the gate's asks, and ${to} already holds one moved aside: remove one of them`,
			);
		}
		mkdirSync(quarantineDir, { recursive: true });
		renameSync(from, to);
		if (!moved.includes(entry)) moved.push(entry);
		writeFileSync(manifestPath, JSON.stringify(moved));
	}
	return { ok: true, value: undefined };
}

/**
 * Puts back what `quarantineOverrides` moved aside. An entry whose place
 * has been taken since stays in the quarantine, still recorded, and the
 * result is an error naming it: nothing is overwritten.
 */
function restoreOverrides(
	configDir: string,
	overrides: readonly string[],
): Result<void, PermissionSetupError> {
	const quarantineDir = quarantineOf(configDir);
	const manifestPath = join(quarantineDir, MOVED);
	if (!present(manifestPath)) return { ok: true, value: undefined };
	const recorded = readMoved(manifestPath, overrides);
	if (!recorded.ok) return recorded;
	const blocked: string[] = [];
	for (const entry of recorded.value) {
		const from = join(quarantineDir, entry);
		const to = join(configDir, entry);
		if (!present(from)) continue;
		if (present(to)) blocked.push(entry);
		else renameSync(from, to);
	}
	if (blocked.length > 0) {
		writeFileSync(manifestPath, JSON.stringify(blocked));
		return fail(
			"io",
			`${blocked.map((entry) => join(configDir, entry)).join(", ")} came back while maina held the repo's own in ${quarantineDir}; left both in place`,
		);
	}
	rmSync(manifestPath, { force: true });
	if (readdirSync(quarantineDir).length === 0) rmdirSync(quarantineDir);
	return { ok: true, value: undefined };
}

function installAcpGate(
	agent: AcpWorker,
	options: ClaudeHookOptions,
): Result<WorkerGateInstall, PermissionSetupError> {
	const { worktree, stateDir, sandbox } = options;
	const { dir, file, overrides } = GATE_CONFIGS[agent];
	const configDir = join(worktree, dir);
	const configPath = join(configDir, file);
	const policyPath = join(stateDir, `${agent}-gate-policy.json`);
	const logPath = join(stateDir, `${agent}-gate-log.jsonl`);
	const backupPath = backupOf(configPath);
	try {
		const existing = readText(configPath);
		const pinned = pinGateConfig(agent, existing);
		if (!pinned.ok) {
			return fail("invalid_settings", `${configPath}: ${pinned.error.message}`);
		}
		mkdirSync(stateDir, { recursive: true, mode: 0o700 });
		writeFileSync(policyPath, JSON.stringify(options.policy), { mode: 0o600 });
		mkdirSync(configDir, { recursive: true });
		const moved = quarantineOverrides(configDir, overrides);
		if (!moved.ok) return moved;
		// The repo's own config, once, before maina first writes over it; or,
		// where there is none, a note that maina made it. A second install
		// finds one or the other and leaves both alone.
		const createdPath = createdMarkerOf(configPath);
		if (!existsSync(backupPath) && !existsSync(createdPath)) {
			if (existing !== undefined) copyFileSync(configPath, backupPath);
			else writeFileSync(createdPath, "");
		}
		writeFileSync(configPath, pinned.value);
	} catch (e) {
		return fail(
			"io",
			`could not install the ${agent} gate config: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	return {
		ok: true,
		value: {
			configDir,
			configPath,
			quarantineDir: quarantineOf(configDir),
			policyPath,
			logPath,
			sandbox: {
				...sandbox,
				writeDeny: [
					...(sandbox.writeDeny ?? []),
					configDir,
					policyPath,
					logPath,
				],
			},
		},
	};
}

/**
 * Installs `worker`'s gate integration in `worktree` and returns the
 * sandbox options that keep it in place. A headless worker other than
 * Claude's is refused: nothing in print mode asks, so there is no gate to
 * install and only the sandbox enforces.
 */
export function installWorkerGate(
	worker: WorkerSpec,
	options: ClaudeHookOptions,
): Result<WorkerGateInstall, PermissionSetupError> {
	for (const [label, path] of [
		["worktree", options.worktree],
		["state directory", options.stateDir],
	] as const) {
		if (!isAbsolute(path))
			return fail("invalid_options", `${label} "${path}" is not absolute`);
	}
	if (isClaude(worker)) {
		const hook = installClaudePreToolUse(worker, options);
		if (!hook.ok) return hook;
		const { settingsPath, policyPath, logPath, sandbox } = hook.value;
		const configDir = join(options.worktree, ".claude");
		return {
			ok: true,
			value: {
				configDir,
				configPath: settingsPath,
				quarantineDir: quarantineOf(configDir),
				policyPath,
				logPath,
				sandbox,
			},
		};
	}
	const agent = acpAgent(worker);
	if (agent === undefined) {
		return fail(
			"unsupported_worker",
			`worker "${worker.name}" is sandbox-only: nothing asks before a call runs, so there is no gate to install`,
		);
	}
	return installAcpGate(agent, options);
}

/**
 * Takes `worker`'s gate integration out of `worktree`: a repo's config
 * comes back byte for byte from the backup, or, when maina created it, it
 * goes, and what the install moved aside is put back. A worktree maina
 * never touched is left as it is.
 */
export function uninstallWorkerGate(
	worker: WorkerSpec,
	worktree: string,
): Result<void, PermissionSetupError> {
	if (isClaude(worker)) return uninstallClaudePreToolUse(worktree);
	const agent = acpAgent(worker);
	if (agent === undefined) return { ok: true, value: undefined };
	const { dir, file, overrides } = GATE_CONFIGS[agent];
	const configPath = join(worktree, dir, file);
	const backupPath = backupOf(configPath);
	const createdPath = createdMarkerOf(configPath);
	try {
		if (existsSync(backupPath)) {
			renameSync(backupPath, configPath);
		} else if (existsSync(createdPath)) {
			rmSync(configPath, { force: true });
		}
		rmSync(createdPath, { force: true });
		return restoreOverrides(join(worktree, dir), overrides);
	} catch (e) {
		return fail(
			"io",
			`could not remove the ${agent} gate config: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}
