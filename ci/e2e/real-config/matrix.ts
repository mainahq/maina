/**
 * Real-config e2e matrix (v1 task 0.1, FR-INS-6).
 *
 * `runCase` installs maina for one host through one install path inside
 * a throwaway HOME + project, then does what the host would do: read the
 * MCP config from the host's real config location, spawn the exact
 * launch command with the host's environment, complete an MCP handshake
 * and call `verify` once.
 *
 * Real host binaries are not needed: the host contract under test is
 * "which file do you read, and what process do you spawn from it".
 *
 * Install paths, as a user would run them:
 *   - plugin       the host's marketplace add + plugin install, from a
 *                  local release of this checkout (`plugin-release.ts`),
 *                  then the first session's session-start hooks, which
 *                  install the runtime and must onboard. Hosts without a
 *                  plugin yet fail as `no-plugin`.
 *   - cli-setup    `setup` from the CLI under test with no global `maina`
 *                  on PATH. It runs this checkout (running the published
 *                  package would test 1.x, not the change). A stable CLI
 *                  writes its own runtime + entry by absolute path (#294);
 *                  before that the entry pinned the checkout's version, and
 *                  any build not on the registry reproduced P3.
 *   - cli-mcp-add  `maina mcp add --client <host>` after `bun install -g`
 *   - install-sh   `curl … | bash`: global install, then install.sh hands
 *                  over to the installed CLI (`maina setup`); it writes no
 *                  config itself (#299)
 *
 * Each case starts from a user who already has the host: its global config
 * is seeded with keys that are not maina's, and must survive (P8).
 *
 * The global install is simulated with the layout bun's installer gives
 * every user: `~/.bun/bin/{bun,bunx}` plus a `maina` bin that is a symlink
 * to the package's bin entry, here this checkout's CLI source (its sh/JS
 * header picks bun, else node, from PATH).
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	type EnvMode,
	type EnvVars,
	hostEnv,
	type Os,
	userShellPath,
} from "./env";
import { claudeCode } from "./hosts/claude-code";
import { codex } from "./hosts/codex";
import { cursor } from "./hosts/cursor";
import { pluginRelease } from "./plugin-release";
import type {
	CaseError,
	CaseResult,
	HostId,
	HostSpec,
	InstallPath,
	LaunchSpec,
	PathCtx,
	Result,
	SeedFile,
} from "./types";

export type {
	CaseError,
	CaseResult,
	HostId,
	InstallPath,
	LaunchSpec,
} from "./types";

// ── Matrix axes ────────────────────────────────────────────────────────────

export const HOSTS: readonly HostId[] = ["claude-code", "cursor", "codex"];

export const INSTALL_PATHS: readonly InstallPath[] = [
	"plugin",
	"cli-setup",
	"cli-mcp-add",
	"install-sh",
];

export const ENV_MODES: readonly EnvMode[] = ["minimal", "gui", "full"];

const HOST_SPECS: Readonly<Record<HostId, HostSpec>> = {
	"claude-code": claudeCode,
	cursor,
	codex,
};

// ── Budgets ────────────────────────────────────────────────────────────────

/** Cold MCP start target (spawn → `initialize` response). */
const COLD_START_BUDGET_MS = numberFromEnv(
	"MAINA_E2E_COLD_START_BUDGET_MS",
	1_500,
);
/** Hard kill: Codex's default `startup_timeout_sec`, the strictest host. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
const TOOL_CALL_TIMEOUT_MS = 30_000;
const INSTALLER_TIMEOUT_MS = 120_000;

// ── Known problems ─────────────────────────────────────────────────────────

/**
 * - P1  installer writes a file the host never reads (Claude `settings.json`,
 *       or no entry at all for the host)
 * - P2  launch needs a runtime missing from a GUI PATH (`env: bun` → 127)
 * - P3  launch pins a version the registry cannot resolve
 * - P4  cold start slower than the budget / host startup timeout
 * - P8  installer rewrites a config the user already had, losing keys
 *       that are not maina's (hooks, permissions, other servers)
 * - no-plugin  the host plugin package does not exist yet
 */
export type KnownProblem = "P1" | "P2" | "P3" | "P4" | "P8" | "no-plugin";

export interface KnownFailure {
	readonly host: HostId;
	readonly installPath: InstallPath;
	/** Env modes the failure applies to; all when omitted. */
	readonly envs?: readonly EnvMode[];
	/**
	 * Acceptable reasons, each mapped to the issue whose fix removes it.
	 * The case must fail with one of these keys.
	 */
	readonly fixes: Readonly<Partial<Record<KnownProblem, number>>>;
	/**
	 * The outcome depends on registry latency (a cold download can beat
	 * the budget on a fast runner), so a pass is tolerated. When it does
	 * fail it must still be for a listed reason. P4-only entries only.
	 */
	readonly mayPass?: true;
}

/**
 * Only the Cursor and Codex plugin paths still fail. History of the fixed
 * entries: #341 shipped the Claude Code marketplace and plugin.
 * #288 made `maina setup` merge `mcpServers.maina` into the project
 * `.mcp.json`, so claude-code with cli-setup passes. #294 made the CLI
 * write its own runtime and entry by absolute path, which fixed P3 for
 * cursor with cli-setup and P2 for cursor and codex with cli-mcp-add.
 * #299 fixed the rest of P1, P2 and P8: every installer resolves host
 * files through the CLI's targets, merges without rewriting, and
 * install.sh only hands over to `maina setup`, so it no longer writes the
 * bare `bunx` whose first-spawn download also caused P4 there.
 */
export const KNOWN_FAILURES: readonly KnownFailure[] = [
	// Plugins: no host package yet (plan tasks 9.3–9.4). Claude Code's
	// marketplace + plugin shipped with #341.
	{
		host: "cursor",
		installPath: "plugin",
		fixes: { "no-plugin": 342 },
	},
	{ host: "codex", installPath: "plugin", fixes: { "no-plugin": 343 } },
];

export function problemsOf(k: KnownFailure): readonly KnownProblem[] {
	return (Object.keys(k.fixes) as KnownProblem[]).filter(
		(p) => k.fixes[p] !== undefined,
	);
}

export function expectedFailure(c: {
	readonly host: HostId;
	readonly installPath: InstallPath;
	readonly env: EnvMode;
}): KnownFailure | undefined {
	return KNOWN_FAILURES.find(
		(k) =>
			k.host === c.host &&
			k.installPath === c.installPath &&
			(k.envs === undefined || k.envs.includes(c.env)),
	);
}

const RUNTIME_MISSING =
	/env: ['‘"]?(bun|node)|(bun|node|bunx|npx): (command )?not found/;
const UNRESOLVABLE_PIN =
	/No version matching|failed to resolve|ETARGET|No matching version|notarget/i;

export function classifyProblem(error: CaseError): KnownProblem | undefined {
	switch (error.kind) {
		case "installer-missing":
			return "no-plugin";
		case "config-not-found":
			return "P1";
		case "config-clobbered":
			return "P8";
		case "command-not-found":
			return "P2";
		case "exited":
			if (error.exitCode === 127 || RUNTIME_MISSING.test(error.stderr)) {
				return "P2";
			}
			if (UNRESOLVABLE_PIN.test(error.stderr)) return "P3";
			return undefined;
		case "handshake-timeout":
		case "cold-start-over-budget":
			return "P4";
		case "installer-failed":
		case "config-invalid":
		case "session-start-failed":
		case "handshake-rejected":
		case "tool-call-failed":
			return undefined;
		default: {
			const never: never = error;
			return never;
		}
	}
}

// ── Reading the host's real config ─────────────────────────────────────────

function parseConfig(
	raw: string,
	format: "json" | "toml",
): Result<unknown, string> {
	try {
		return {
			ok: true,
			value: format === "json" ? JSON.parse(raw) : Bun.TOML.parse(raw),
		};
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

function toLaunch(
	entry: unknown,
	source: string,
): Result<LaunchSpec, CaseError> {
	const invalid = (message: string): Result<LaunchSpec, CaseError> => ({
		ok: false,
		error: { kind: "config-invalid", message, path: source },
	});
	if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
		return invalid("maina entry is not an object");
	}
	const e = entry as Record<string, unknown>;
	if (typeof e.command !== "string" || e.command.length === 0) {
		return invalid("maina entry has no stdio `command`");
	}
	const args = Array.isArray(e.args)
		? e.args.filter((a): a is string => typeof a === "string")
		: [];
	const env: Record<string, string> = {};
	if (e.env && typeof e.env === "object" && !Array.isArray(e.env)) {
		for (const [k, v] of Object.entries(e.env)) {
			if (typeof v === "string") env[k] = v;
		}
	}
	return { ok: true, value: { command: e.command, args, env, source } };
}

/**
 * Find the maina launch command exactly where `host` looks for it.
 * `readFile` returns null for a missing file.
 */
export function resolveLaunch(
	host: HostId,
	ctx: PathCtx,
	readFile: (path: string) => string | null,
): Result<LaunchSpec, CaseError> {
	const spec = HOST_SPECS[host];
	const sources = spec.configSources(ctx, readFile);
	for (const source of sources) {
		const raw = readFile(source.path);
		if (raw === null) continue;
		const parsed = parseConfig(raw, source.format);
		if (!parsed.ok) {
			return {
				ok: false,
				error: {
					kind: "config-invalid",
					message: `${source.path}: ${parsed.error}`,
					path: source.path,
				},
			};
		}
		const entry = source.select(parsed.value);
		if (entry !== undefined) return toLaunch(entry, source.path);
	}
	const searched = [...new Set(sources.map((s) => s.path))];
	const strays = spec.strayPaths(ctx).filter((p) => readFile(p) !== null);
	return {
		ok: false,
		error: {
			kind: "config-not-found",
			message: `no maina entry where ${host} reads MCP config (${searched.join(", ")})${
				strays.length > 0 ? `; installer wrote ${strays.join(", ")}` : ""
			}`,
			searched,
			strays,
		},
	};
}

// ── Seeded configs (P8) ────────────────────────────────────────────────────

/** The host configs a real user already has, written before installing. */
export function seedsFor(host: HostId, ctx: PathCtx): readonly SeedFile[] {
	return HOST_SPECS[host].seeds(ctx);
}

/** Every seeded config must still exist and hold its own keys. */
export function checkSeeds(
	host: HostId,
	ctx: PathCtx,
	readFile: (path: string) => string | null,
): Result<void, CaseError> {
	for (const seed of seedsFor(host, ctx)) {
		const raw = readFile(seed.path);
		const parsed = raw === null ? null : parseConfig(raw, seed.format);
		if (parsed === null || !parsed.ok || !seed.intact(parsed.value)) {
			return {
				ok: false,
				error: {
					kind: "config-clobbered",
					message: `installer ${
						raw === null ? "deleted" : "rewrote"
					} ${seed.path} and lost keys that are not maina's`,
					path: seed.path,
				},
			};
		}
	}
	return { ok: true, value: undefined };
}

function writeSeeds(host: HostId, ctx: PathCtx): void {
	for (const seed of seedsFor(host, ctx)) {
		mkdirSync(dirname(seed.path), { recursive: true });
		writeFileSync(seed.path, seed.content);
	}
}

// ── Workspace ──────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "packages", "cli", "src", "index.ts");
const INSTALL_SH = join(REPO_ROOT, "install.sh");

/**
 * The user's shell env is a *fresh* bun user's shell, not this runner's:
 * session identity plus network/registry settings (they change how bunx
 * resolves, and never point outside the sandbox). Deliberately dropped:
 * anything locating config or state in the real home (`XDG_*`,
 * `BUN_INSTALL`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, …), agent markers
 * (`CLAUDE_CODE`, `CURSOR_*`) that flip maina's host detection, and API
 * keys that would turn on real model calls. Inheriting those would let a
 * case write to, or depend on, the machine running the matrix.
 */
const SHELL_PASSTHROUGH: readonly string[] = [
	"USER",
	"LOGNAME",
	"SHELL",
	"TMPDIR",
	"LANG",
	"LC_ALL",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"NPM_CONFIG_REGISTRY",
	"BUN_CONFIG_REGISTRY",
	"SSL_CERT_FILE",
	"NODE_EXTRA_CA_CERTS",
];

export interface Workspace {
	readonly root: string;
	readonly home: string;
	readonly cwd: string;
	/** The user's interactive shell env (installer runs with it). */
	readonly shellEnv: EnvVars;
}

export function createWorkspace(os: Os, globalMaina: boolean): Workspace {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "maina-real-config-")));
	const home = join(root, "home");
	const cwd = join(root, "project");
	const bin = join(home, ".bun", "bin");
	mkdirSync(bin, { recursive: true });
	mkdirSync(cwd, { recursive: true });

	// bun's installer layout: bunx is a symlink to the bun binary.
	symlinkSync(process.execPath, join(bin, "bun"));
	symlinkSync(process.execPath, join(bin, "bunx"));
	// …and a global package's bin is a symlink to its (executable) bin file.
	if (globalMaina) symlinkSync(CLI_ENTRY, join(bin, "maina"));

	// Opt the sandbox user out of CLI crash reports. GUI/minimal launches
	// carry no MAINA_TELEMETRY/DO_NOT_TRACK, so without this a server that
	// crashes under test would report to production. The file flag keeps
	// the launch env itself identical to what the host passes.
	mkdirSync(join(home, ".maina"), { recursive: true });
	writeFileSync(
		join(home, ".maina", "telemetry.json"),
		`${JSON.stringify({ optOut: true })}\n`,
	);

	const passthrough: Record<string, string> = {};
	for (const key of SHELL_PASSTHROUGH) {
		const value = process.env[key];
		if (value !== undefined) passthrough[key] = value;
	}
	const shellEnv: EnvVars = {
		...passthrough,
		PATH: userShellPath(os, home),
		HOME: home,
		MAINA_TELEMETRY: "0",
		DO_NOT_TRACK: "1",
	};

	Bun.spawnSync(["git", "init", "-q"], { cwd, env: shellEnv });
	return { root, home, cwd, shellEnv };
}

function readOrNull(path: string): string | null {
	try {
		return existsSync(path) ? readFileSync(path, "utf-8") : null;
	} catch {
		return null;
	}
}

// ── Installers ─────────────────────────────────────────────────────────────

async function runInstaller(
	argv: readonly string[],
	w: Workspace,
): Promise<Result<void, CaseError>> {
	const proc = Bun.spawn([...argv], {
		cwd: w.cwd,
		env: w.shellEnv,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: INSTALLER_TIMEOUT_MS,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode === 0) return { ok: true, value: undefined };
	return {
		ok: false,
		error: {
			kind: "installer-failed",
			message: `${argv.slice(0, 3).join(" ")} exited ${exitCode}: ${(stderr || stdout).slice(-2_000)}`,
			exitCode,
		},
	};
}

/**
 * install.sh minus its `main "$@"` call, then only its hand-off to the
 * CLI (`run_setup`). The global package install it would do first is
 * simulated by the shim.
 */
function installShScript(): Result<string, CaseError> {
	const source = readOrNull(INSTALL_SH);
	const call = /^main "\$@"\s*$/m;
	if (source === null || !call.test(source)) {
		return {
			ok: false,
			error: {
				kind: "installer-failed",
				message:
					'cannot isolate install.sh functions (no trailing `main "$@"`)',
				exitCode: null,
			},
		};
	}
	return {
		ok: true,
		value: `${source.replace(call, "")}\nrun_setup\n`,
	};
}

async function install(
	spec: HostSpec,
	installPath: InstallPath,
	w: Workspace,
): Promise<Result<void, CaseError>> {
	switch (installPath) {
		case "plugin": {
			if (spec.plugin === undefined) {
				return {
					ok: false,
					error: {
						kind: "installer-missing",
						message: `no ${spec.id} plugin package exists yet`,
					},
				};
			}
			const release = await pluginRelease();
			if (!release.ok) {
				return {
					ok: false,
					error: {
						kind: "installer-failed",
						message: `staging the plugin release failed: ${release.error}`,
						exitCode: null,
					},
				};
			}
			return spec.plugin.install(
				{ home: w.home, cwd: w.cwd },
				release.value.marketplace,
			);
		}
		case "cli-setup":
			return runInstaller(
				[
					process.execPath,
					CLI_ENTRY,
					"setup",
					"--yes",
					"--ci",
					"--no-telemetry",
				],
				w,
			);
		case "cli-mcp-add":
			return runInstaller(
				[
					join(w.home, ".bun", "bin", "maina"),
					"mcp",
					"add",
					"--client",
					spec.mcpAddClient,
				],
				w,
			);
		case "install-sh": {
			const script = installShScript();
			if (!script.ok) return script;
			return runInstaller(["/bin/bash", "-c", script.value], w);
		}
		default: {
			const never: never = installPath;
			return never;
		}
	}
}

// ── MCP session ────────────────────────────────────────────────────────────

interface RpcMessage {
	readonly id?: number;
	readonly result?: unknown;
	readonly error?: { readonly message?: string };
}

type Wait =
	| { readonly type: "response"; readonly msg: RpcMessage }
	| { readonly type: "exit"; readonly code: number | null }
	| { readonly type: "timeout" };

/**
 * Resolve `command` the way a host's spawn does: a path (anything with a
 * `/`) is taken relative to the spawn cwd, a bare name is looked up on the
 * spawn env's PATH.
 */
function resolveCommand(
	command: string,
	env: EnvVars,
	cwd: string,
): string | null {
	if (command.includes("/")) {
		const path = isAbsolute(command) ? command : resolve(cwd, command);
		return existsSync(path) ? path : null;
	}
	return Bun.which(command, { PATH: env.PATH ?? "" });
}

export interface ProbeOptions {
	readonly coldStartBudgetMs?: number;
}

/**
 * Spawn `launch` the way a host does, then `initialize` + one `verify`.
 * `started` means `initialize` answered; missing the cold-start budget is
 * reported as an error on an otherwise started server.
 */
export async function probeLaunch(
	launch: LaunchSpec,
	env: EnvVars,
	cwd: string,
	opts: ProbeOptions = {},
): Promise<CaseResult> {
	const budgetMs = opts.coldStartBudgetMs ?? COLD_START_BUDGET_MS;
	// Hosts merge the entry's env over their own and spawn with that, so
	// PATH lookup uses the merged PATH too.
	const spawnEnv: EnvVars = { ...env, ...launch.env };
	const executable = resolveCommand(launch.command, spawnEnv, cwd);
	if (executable === null) {
		return {
			started: false,
			handshakeMs: null,
			toolCallOk: false,
			launch,
			error: {
				kind: "command-not-found",
				message: `${launch.command} not found on PATH=${spawnEnv.PATH ?? ""}`,
				command: launch.command,
			},
		};
	}

	const t0 = performance.now();
	const proc = Bun.spawn([executable, ...launch.args], {
		cwd,
		env: spawnEnv,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	const pending = new Map<number, (msg: RpcMessage) => void>();
	const stderrText = new Response(proc.stderr).text();
	const exited: Promise<Wait> = proc.exited.then((code) => ({
		type: "exit",
		code,
	}));

	void (async () => {
		const decoder = new TextDecoder();
		let buffer = "";
		for await (const chunk of proc.stdout) {
			buffer += decoder.decode(chunk, { stream: true });
			let nl = buffer.indexOf("\n");
			while (nl >= 0) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				nl = buffer.indexOf("\n");
				if (line.length === 0) continue;
				try {
					const msg = JSON.parse(line) as RpcMessage;
					if (typeof msg.id === "number") pending.get(msg.id)?.(msg);
				} catch {
					// Non-JSON on stdout: hosts drop it too.
				}
			}
		}
	})();

	const send = (msg: Record<string, unknown>): void => {
		try {
			proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
			proc.stdin.flush();
		} catch {
			// Child already gone (EPIPE); the `exited` race reports why.
		}
	};

	const request = (
		id: number,
		method: string,
		params: unknown,
		timeoutMs: number,
	): Promise<Wait> => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const response = new Promise<Wait>((done) => {
			pending.set(id, (msg) => done({ type: "response", msg }));
		});
		const timeout = new Promise<Wait>((done) => {
			timer = setTimeout(() => done({ type: "timeout" }), timeoutMs);
		});
		send({ id, method, params });
		return Promise.race([response, exited, timeout]).finally(() => {
			clearTimeout(timer);
			pending.delete(id);
		});
	};

	const finish = async (
		result: Omit<CaseResult, "launch">,
	): Promise<CaseResult> => {
		proc.kill();
		await proc.exited;
		return { ...result, launch };
	};

	const exitError = async (code: number | null): Promise<CaseError> => {
		const stderr = (await stderrText).slice(-2_000);
		return {
			kind: "exited",
			message: `${launch.command} exited ${code} before responding: ${stderr}`,
			exitCode: code,
			stderr,
		};
	};

	const init = await request(
		1,
		"initialize",
		{
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "maina-real-config-e2e", version: "0.0.0" },
		},
		HANDSHAKE_TIMEOUT_MS,
	);
	if (init.type === "exit") {
		return finish({
			started: false,
			handshakeMs: null,
			toolCallOk: false,
			error: await exitError(init.code),
		});
	}
	if (init.type === "timeout") {
		return finish({
			started: false,
			handshakeMs: null,
			toolCallOk: false,
			error: {
				kind: "handshake-timeout",
				message: `no initialize response within ${HANDSHAKE_TIMEOUT_MS}ms`,
				timeoutMs: HANDSHAKE_TIMEOUT_MS,
			},
		});
	}
	if (init.msg.error !== undefined || !("result" in init.msg)) {
		return finish({
			started: false,
			handshakeMs: null,
			toolCallOk: false,
			error: {
				kind: "handshake-rejected",
				message:
					init.msg.error !== undefined
						? `initialize returned a JSON-RPC error: ${JSON.stringify(init.msg.error).slice(0, 500)}`
						: `initialize response has no result: ${JSON.stringify(init.msg).slice(0, 500)}`,
			},
		});
	}
	const handshakeMs = Math.round(performance.now() - t0);
	// Slow start is still a start: keep going so `toolCallOk` is truthful,
	// and report the budget miss unless a harder failure follows.
	const overBudget: CaseError | undefined =
		handshakeMs > budgetMs
			? {
					kind: "cold-start-over-budget",
					message: `initialize took ${handshakeMs}ms (budget ${budgetMs}ms)`,
					handshakeMs,
					budgetMs,
				}
			: undefined;

	send({ method: "notifications/initialized" });
	const call = await request(
		2,
		"tools/call",
		{ name: "verify", arguments: { files: [] } },
		TOOL_CALL_TIMEOUT_MS,
	);
	if (call.type !== "response") {
		return finish({
			started: true,
			handshakeMs,
			toolCallOk: false,
			error:
				call.type === "exit"
					? await exitError(call.code)
					: {
							kind: "tool-call-failed",
							message: `verify did not answer within ${TOOL_CALL_TIMEOUT_MS}ms`,
						},
		});
	}
	// JSON-RPC success needs a `result`; an id-only reply is malformed.
	const isError =
		call.msg.error !== undefined ||
		!("result" in call.msg) ||
		(call.msg.result as { isError?: boolean } | undefined)?.isError === true;
	// MCP v2 (#335, #421): verify answers with structured content that
	// carries every tool's status, so a client sees skipped tools too.
	const structured = (
		call.msg.result as
			| { structuredContent?: { data?: { tools?: unknown } } }
			| undefined
	)?.structuredContent;
	const unstructured = !isError && !Array.isArray(structured?.data?.tools);
	const error: CaseError | undefined = isError
		? {
				kind: "tool-call-failed",
				message: `verify failed: ${JSON.stringify(call.msg).slice(0, 1_000)}`,
			}
		: unstructured
			? {
					kind: "tool-call-failed",
					message: `verify answered without per-tool status (structuredContent.data.tools): ${JSON.stringify(call.msg).slice(0, 1_000)}`,
				}
			: overBudget;
	return finish({
		started: true,
		handshakeMs,
		toolCallOk: !isError && !unstructured,
		...(error ? { error } : {}),
	});
}

// ── runCase ────────────────────────────────────────────────────────────────

export interface CaseSpec {
	readonly host: HostId;
	readonly os: Os;
	readonly installPath: InstallPath;
	readonly env: EnvMode;
}

export async function runCase(spec: CaseSpec): Promise<CaseResult> {
	const host = HOST_SPECS[spec.host];
	const globalMaina = spec.installPath !== "cli-setup";
	const w = createWorkspace(spec.os, globalMaina);
	const ctx: PathCtx = { home: w.home, cwd: w.cwd };
	const notStarted = (error: CaseError): CaseResult => ({
		started: false,
		handshakeMs: null,
		toolCallOk: false,
		error,
	});
	try {
		writeSeeds(spec.host, ctx);
		const installed = await install(host, spec.installPath, w);
		if (!installed.ok) return notStarted(installed.error);
		// P1 (no entry where the host reads) outranks P8 (a clobbered file).
		const launch = resolveLaunch(spec.host, ctx, readOrNull);
		if (!launch.ok) return notStarted(launch.error);
		const seeds = checkSeeds(spec.host, ctx, readOrNull);
		if (!seeds.ok) return notStarted(seeds.error);
		const env = hostEnv(spec.env, {
			os: spec.os,
			home: w.home,
			shellEnv: w.shellEnv,
		});
		// A plugin's first session starts before its MCP server does: the
		// session-start hook installs the runtime, then the server starts
		// from cache.
		if (spec.installPath === "plugin" && host.plugin !== undefined) {
			const session = await host.plugin.startSession(ctx, env);
			if (!session.ok) return notStarted(session.error);
		}
		return await probeLaunch(launch.value, env, w.cwd);
	} finally {
		if (process.env.MAINA_E2E_KEEP !== "1") {
			rmSync(w.root, { recursive: true, force: true });
		}
	}
}

function numberFromEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	const n = raw === undefined ? Number.NaN : Number(raw);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}
