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
 *
 * The returned sandbox denies writes to the config's directory, the policy
 * record and the log, so a prompt-injected agent cannot switch its own
 * asking off, plant another config beside the pinned one, or rewrite the
 * gate's record. A repo's existing config is backed up before the first
 * write and restored by `uninstallWorkerGate`.
 *
 * `GATE_CONFIGS` and `pinGateConfig` are pure; the install and uninstall
 * are the imperative shell.
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
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
}>;

export const GATE_CONFIGS: Readonly<Record<AcpWorker, GateConfig>> = {
	// Project-scoped Codex config; `untrusted` asks before anything that is
	// not a known-safe read.
	codex: { dir: ".codex", file: "config.toml" },
	// The Cursor CLI's project config (permissions only): an allow entry
	// runs without asking.
	cursor: { dir: ".cursor", file: "cli.json" },
	// Gemini CLI project settings: `autoAccept` skips the ask for tools it
	// deems safe, YOLO mode for everything.
	gemini: { dir: ".gemini", file: "settings.json" },
	// OpenCode merges `.opencode/opencode.json` over the root config, and
	// loads plugins (which can answer its asks) from the same directory.
	opencode: { dir: ".opencode", file: "opencode.json" },
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
	opencode: { permission: OPENCODE_ASK },
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
	/** The run's policy, recorded outside the worktree. */
	policyPath: string;
	/** Where the gate's permission records go (JSON lines). */
	logPath: string;
	/** `sandbox` with the gate's files protected. */
	sandbox: SandboxOptions;
}>;

const backupOf = (configPath: string): string => `${configPath}.maina-backup`;
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

function installAcpGate(
	agent: AcpWorker,
	options: ClaudeHookOptions,
): Result<WorkerGateInstall, PermissionSetupError> {
	const { worktree, stateDir, sandbox } = options;
	const { dir, file } = GATE_CONFIGS[agent];
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
		return {
			ok: true,
			value: {
				configDir: join(options.worktree, ".claude"),
				configPath: settingsPath,
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
 * goes. A worktree maina never touched is left as it is.
 */
export function uninstallWorkerGate(
	worker: WorkerSpec,
	worktree: string,
): Result<void, PermissionSetupError> {
	if (isClaude(worker)) return uninstallClaudePreToolUse(worktree);
	const agent = acpAgent(worker);
	if (agent === undefined) return { ok: true, value: undefined };
	const { dir, file } = GATE_CONFIGS[agent];
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
		return { ok: true, value: undefined };
	} catch (e) {
		return fail(
			"io",
			`could not remove the ${agent} gate config: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
}
