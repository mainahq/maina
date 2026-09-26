/**
 * `maina doctor` v2 host health (FR-INS-6).
 *
 * For every host config that holds a maina entry, doctor launches the
 * exact configured command under the host's minimal environment and
 * checks, in order: the entry itself (config), that the command resolves
 * (launch), the MCP `initialize` handshake, and which maina runtime
 * answered. Once per repo it checks the root the server resolves, the
 * gate policy, and the local model.
 *
 * Every check is pass / skipped / warn / fail; every fail carries a fix
 * command.
 *
 * A project-scope entry comes from the repo, so launching it runs code the
 * repo controls. Doctor launches one only when it is maina's own launcher
 * (`trustedProjectLaunch`); any other is reported `skipped` unless the
 * caller opts in with `launchProject` (`maina doctor --launch-project`).
 * The `bunx`/`npx` launcher form counts as maina's only while the repo
 * ships no `node_modules/@mainahq/cli` the runner could resolve instead
 * and no project `.npmrc` that could point it at another registry.
 * User-scope entries are the user's own and always launch.
 *
 * Every launch doctor makes on its own (user-scope entries and trusted
 * project entries) starts in `launchCwd`, an empty directory outside the
 * repo, not in the repo: bun reads `bunfig.toml` from its cwd, so a repo
 * `preload` would otherwise run repo code ahead of any bun-backed launcher
 * (`bun <entry>`, the `maina` shim, `bunx`). Only an entry launched because
 * the user passed `--launch-project` starts in the repo, as its host would.
 * This module is pure apart from the injected ports: `./probe.ts` does the
 * spawning, `commands/doctor.ts` wires the real filesystem and git.
 */

import { dirname, isAbsolute, join, normalize, relative } from "node:path";
import type { PolicyError } from "@mainahq/core";
import { buildClientRegistry, listClientIds } from "./clients";
import { codexApplyPatchCheck, codexHookFiles } from "./codex-rules";
import { type EnvVars, hostOs, minimalEnv } from "./host-env";
import { isMainaLauncher, isPackageRunnerLauncher } from "./launcher";
import { readEntry } from "./merge";
import type { LaunchSpec, Probe, ProbeOutcome } from "./probe";
import {
	ignoredTargets,
	type PathContext,
	type TargetFile,
	type TargetScope,
	targetsFor,
} from "./targets";
import type { McpClientId } from "./types";

// ── Report ──────────────────────────────────────────────────────────────────

/** `skipped`: not run, so neither verified nor broken. */
export type CheckStatus = "pass" | "skipped" | "warn" | "fail";

export interface HealthCheck<Id extends string = string> {
	readonly id: Id;
	readonly status: CheckStatus;
	readonly message: string;
	/** Shell command that fixes it; always set on `fail` and `skipped`. */
	readonly fix?: string;
}

type HostCheckId = "config" | "launch" | "handshake" | "runtime";
type RuntimeCheckId = "root" | "policy" | "model" | "codex";

/** One configured maina entry, launched the way its host launches it. */
export interface HostLaunchReport {
	readonly host: McpClientId;
	readonly label: string;
	readonly scope: TargetScope;
	/** The config file the entry was read from. */
	readonly path: string;
	/** `command` + `args` as configured; null when the entry has none. */
	readonly command: readonly string[] | null;
	readonly handshakeMs: number | null;
	/** The worst of `checks`. */
	readonly status: CheckStatus;
	readonly checks: readonly HealthCheck<HostCheckId>[];
}

export interface HostHealth {
	/** False when any check failed. */
	readonly ok: boolean;
	/** The environment entries were launched under. */
	readonly launchEnv: {
		readonly mode: LaunchEnv["mode"];
		readonly PATH: string;
	};
	readonly hosts: readonly HostLaunchReport[];
	readonly runtime: readonly HealthCheck<RuntimeCheckId>[];
}

type Result<T, E> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

// ── Pure checks ─────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Readonly<Record<string, unknown>> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strings(v: unknown): readonly string[] {
	return Array.isArray(v)
		? v.filter((a): a is string => typeof a === "string")
		: [];
}

function stringRecord(v: unknown): EnvVars {
	if (!isObj(v)) return {};
	return Object.fromEntries(
		Object.entries(v).filter(
			(kv): kv is [string, string] => typeof kv[1] === "string",
		),
	);
}

/**
 * The process an entry makes its host spawn. Reads the stdio shape most
 * hosts use (`command` / `args` / `env`), Zed's nested `command.path` and
 * Continue's `transport`.
 */
export function launchSpecOf(entry: unknown): Result<LaunchSpec, string> {
	if (!isObj(entry)) {
		return { ok: false, error: "maina's entry is not an object" };
	}
	const stdio = isObj(entry.transport)
		? entry.transport
		: isObj(entry.command)
			? {
					command: entry.command.path,
					args: entry.command.args,
					env: entry.command.env,
				}
			: entry;
	if (typeof stdio.command !== "string" || stdio.command.length === 0) {
		return { ok: false, error: "maina's entry has no stdio `command`" };
	}
	return {
		ok: true,
		value: {
			command: stdio.command,
			args: strings(stdio.args),
			env: stringRecord(stdio.env),
		},
	};
}

interface LaunchEnv {
	/** `minimal`: the host's GUI env; `inherited`: no known GUI env. */
	readonly mode: "minimal" | "inherited";
	readonly env: EnvVars;
}

/** The env a host spawns MCP servers with on `platform`. */
export function launchEnv(
	platform: string,
	home: string,
	inherited: EnvVars,
): LaunchEnv {
	const os = hostOs(platform);
	return os === null
		? { mode: "inherited", env: { ...inherited, HOME: home } }
		: { mode: "minimal", env: { ...minimalEnv(os), HOME: home } };
}

/** The launch, handshake and runtime checks for one probe outcome. */
export function evaluateLaunch(
	outcome: ProbeOutcome,
	version: string,
	fix: string,
): readonly HealthCheck<HostCheckId>[] {
	if (outcome.kind === "not-found") {
		return [
			{
				id: "launch",
				status: "fail",
				message: `\`${outcome.command}\` is not on the host's PATH (${outcome.path}); a GUI-launched host cannot start it`,
				fix,
			},
		];
	}
	if (outcome.kind === "spawn-failed") {
		return [
			{
				id: "launch",
				status: "fail",
				message: `could not spawn ${outcome.executable}: ${outcome.message}`,
				fix,
			},
		];
	}
	const launched: HealthCheck<HostCheckId> = {
		id: "launch",
		status: "pass",
		message: `spawned ${outcome.executable}`,
	};
	const handshakeFail = (message: string): HealthCheck<HostCheckId>[] => [
		launched,
		{ id: "handshake", status: "fail", message, fix },
	];
	switch (outcome.kind) {
		case "exited":
			return handshakeFail(
				`exited ${outcome.exitCode ?? "on a signal"} before answering initialize${
					outcome.stderr.length > 0 ? `: ${outcome.stderr}` : ""
				}`,
			);
		case "timeout":
			return handshakeFail(
				`no initialize response within ${outcome.timeoutMs / 1000}s`,
			);
		case "rejected":
			return handshakeFail(`initialize was rejected: ${outcome.message}`);
		case "ready":
			return [
				launched,
				{
					id: "handshake",
					status: "pass",
					message: `initialize answered in ${outcome.handshakeMs}ms (MCP ${outcome.protocolVersion || "unknown"})`,
				},
				runtimeCheck(outcome.serverName, outcome.serverVersion, version, fix),
			];
		default: {
			const never: never = outcome;
			return never;
		}
	}
}

function runtimeCheck(
	name: string,
	running: string,
	expected: string,
	fix: string,
): HealthCheck<HostCheckId> {
	if (name !== "maina") {
		return {
			id: "runtime",
			status: "fail",
			message: `the server identifies as "${name || "unknown"}", not maina`,
			fix,
		};
	}
	return running === expected
		? { id: "runtime", status: "pass", message: `maina ${running}` }
		: {
				id: "runtime",
				status: "warn",
				message: `the host runs maina ${running || "unknown"}, this CLI is ${expected}`,
				fix,
			};
}

/**
 * Where the server roots. It works in the directory the host spawns it in,
 * which is the workspace (repo) root.
 */
export function rootCheck(
	cwd: string,
	repoRoot: string | null,
	hasMainaDir: boolean,
): HealthCheck<"root"> {
	if (repoRoot === null) {
		return {
			id: "root",
			status: "warn",
			message: `${cwd} is not in a git repository; the server roots at ${cwd}`,
			fix: "git init",
		};
	}
	if (repoRoot !== cwd) {
		return {
			id: "root",
			status: "warn",
			message: `hosts spawn the server at the repo root ${repoRoot}, not ${cwd}; project configs were read from ${cwd}`,
			fix: `cd ${repoRoot} && maina doctor`,
		};
	}
	return hasMainaDir
		? { id: "root", status: "pass", message: `server roots at ${cwd}` }
		: {
				id: "root",
				status: "warn",
				message: `server roots at ${cwd}, which has no .maina/`,
				fix: "maina setup",
			};
}

/** Whether the effective gate policy (defaults < user < repo) is valid. */
function policyCheck(
	result: Result<unknown, readonly PolicyError[]>,
	file: string,
	fileExists: boolean,
): HealthCheck<"policy"> {
	if (!result.ok) {
		const problems = result.error
			.map((e) => (e.path.length > 0 ? `${e.path}: ${e.message}` : e.message))
			.join("; ");
		return {
			id: "policy",
			status: "fail",
			message: `invalid policy: ${problems}`,
			fix: `\${EDITOR:-vi} ${file}`,
		};
	}
	return {
		id: "policy",
		status: "pass",
		message: fileExists
			? `${file} is valid`
			: "built-in defaults (no policy file)",
	};
}

type ModelState =
	| { readonly state: "absent"; readonly dir: string }
	| { readonly state: "present"; readonly dir: string };

/**
 * The local system1 model. Download and signature verification land with
 * the model backend (#338); until then presence is all doctor can see.
 */
export function modelCheck(model: ModelState): HealthCheck<"model"> {
	return model.state === "absent"
		? {
				id: "model",
				status: "warn",
				message: `local model not installed yet (${model.dir}); heuristics serve every decision`,
				fix: "maina model pull",
			}
		: {
				id: "model",
				status: "warn",
				message: `model files in ${model.dir}; signature not verified`,
				fix: "maina model verify",
			};
}

const RANK: Readonly<Record<CheckStatus, number>> = {
	pass: 0,
	skipped: 1,
	warn: 2,
	fail: 3,
};

function worst(checks: readonly HealthCheck[]): CheckStatus {
	return checks.reduce<CheckStatus>(
		(acc, c) => (RANK[c.status] > RANK[acc] ? c.status : acc),
		"pass",
	);
}

// ── Untrusted project entries ───────────────────────────────────────────────

const SKIPPED_REASON =
	"project command not recognised as maina's launcher; not executed";
const CLI_PACKAGE_DIR = join("node_modules", "@mainahq", "cli");
const shadowedReason = (shadow: string): string =>
	`the repo ships ${shadow}, which can make the package runner resolve ` +
	"something other than the published CLI; not executed";
const LAUNCH_PROJECT_FIX = "maina doctor --launch-project";

/** Whether absolute `path` is `dir` or below it. */
function within(dir: string, path: string): boolean {
	const rel = relative(dir, path);
	return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * The repo-controlled directories a package runner started in `cwd` reads
 * project state from: cwd and each ancestor up to the repo root (npx looks
 * up from the cwd). Outside a repo, or when cwd is not below its root, only
 * cwd. The walk ends on path equality (`relative` is empty), not string
 * equality, so a root spelled unlike `dirname`'s output (Windows git's
 * `C:/x`) still ends it; the filesystem root is a hard stop.
 */
function runnerDirs(cwd: string, repoRoot: string | null): readonly string[] {
	const dirs = [cwd];
	if (repoRoot === null || !within(repoRoot, cwd)) return dirs;
	let dir = cwd;
	while (relative(repoRoot, dir) !== "") {
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
		dirs.push(dir);
	}
	return dirs;
}

/** Every repo-controlled `node_modules/@mainahq/cli` npx could resolve. */
export function localCliCopies(
	cwd: string,
	repoRoot: string | null,
): readonly string[] {
	return runnerDirs(cwd, repoRoot).map((d) => join(d, CLI_PACKAGE_DIR));
}

/**
 * Every repo-controlled project `.npmrc` npx could read: its `registry=`
 * (or `@mainahq:registry=`) picks where `@mainahq/cli@X` comes from.
 */
export function localNpmrcs(
	cwd: string,
	repoRoot: string | null,
): readonly string[] {
	return runnerDirs(cwd, repoRoot).map((d) => join(d, ".npmrc"));
}

interface TrustOptions {
	readonly realpath?: (path: string) => string;
	/**
	 * A repo file that can redirect a package runner's resolution of
	 * `@mainahq/cli@X` (`localCliCopies`, `localNpmrcs`), or null. A
	 * `bunx`/`npx` entry could then run something other than the release.
	 */
	readonly packageShadow?: string | null;
}

/**
 * Whether a project-scope entry may be launched without asking: it is one
 * of maina's own launcher forms (`isMainaLauncher`), sets no env of its
 * own (an `env` can preload code or move `PATH`; maina never writes one),
 * and neither its executable nor its CLI entry is a file the repo ships.
 * A bare executable name is looked up on the host's PATH, not in the repo.
 * The `bunx`/`npx` form is trusted only while the repo ships nothing that
 * can redirect the runner's resolution of `@mainahq/cli` (`packageShadow`).
 */
export function trustedProjectLaunch(
	spec: LaunchSpec,
	repoDirs: readonly string[],
	{ realpath = (p) => p, packageShadow = null }: TrustOptions = {},
): boolean {
	if (Object.keys(spec.env).length > 0) return false;
	if (!isMainaLauncher(spec)) return false;
	if (packageShadow !== null && isPackageRunnerLauncher(spec)) return false;
	// The executable when given as a path, and the CLI entry of the runtime
	// form (`isMainaLauncher` only accepts that one as an absolute path).
	const files = [
		...(/[\\/]/.test(spec.command) ? [spec.command] : []),
		...spec.args.filter((a) => isAbsolute(a)),
	];
	return files.every((p) => {
		if (!isAbsolute(p)) return false;
		const forms = [normalize(p), realpath(normalize(p))];
		return !forms.some((f) => repoDirs.some((dir) => within(dir, f)));
	});
}

function addFix(host: McpClientId, scope: TargetScope): string {
	return `maina mcp add --client ${host} --scope ${scope}`;
}

// ── Configured entries ──────────────────────────────────────────────────────

type Found =
	| {
			readonly kind: "entry";
			readonly target: TargetFile;
			readonly entry: unknown;
	  }
	| {
			readonly kind: "unreadable";
			readonly target: TargetFile;
			readonly reason: string;
	  }
	| { readonly kind: "ignored"; readonly target: TargetFile };

/** Every maina entry in a file a host reads, plus any in a file it ignores. */
function findEntries(
	ctx: PathContext,
	readFile: (path: string) => string | null,
): readonly Found[] {
	return listClientIds().flatMap((host): Found[] => {
		const read = targetsFor(host, "both", ctx).flatMap((target): Found[] => {
			const text = readFile(target.path);
			if (text === null) return [];
			const found = readEntry(target, text);
			if (!found.ok)
				return [{ kind: "unreadable", target, reason: found.reason }];
			return found.value === undefined
				? []
				: [{ kind: "entry", target, entry: found.value }];
		});
		const ignored = ignoredTargets(host, ctx).flatMap((target): Found[] => {
			const text = readFile(target.path);
			if (text === null) return [];
			const found = readEntry(target, text);
			return found.ok && found.value !== undefined
				? [{ kind: "ignored", target }]
				: [];
		});
		return [...read, ...ignored];
	});
}

// ── Orchestration ───────────────────────────────────────────────────────────

interface HostHealthInput {
	readonly ctx: PathContext;
	/** This CLI's version; the launched server should report the same. */
	readonly version: string;
	readonly platform: string;
	/** Used as the launch env only where no GUI env is known. */
	readonly inheritedEnv: EnvVars;
	/**
	 * Launch project-scope entries that are not maina's own launcher too.
	 * They run code the repo controls; off unless the user opts in.
	 */
	readonly launchProject?: boolean;
}

export interface HostHealthPorts {
	/** File contents, or null when absent/unreadable. */
	readonly readFile: (path: string) => string | null;
	/** Directory entries, or null when it is not a directory. */
	readonly listDir: (path: string) => readonly string[] | null;
	readonly realpath: (path: string) => string;
	/** Top of the git work tree containing `cwd`, or null. */
	readonly repoRoot: (cwd: string) => Promise<string | null>;
	readonly loadPolicy: (
		root: string,
	) => Promise<Result<unknown, readonly PolicyError[]>>;
	/**
	 * An empty directory outside the repo that doctor's own launches start
	 * in, so no repo `bunfig.toml` preload runs (see the module comment).
	 */
	readonly launchCwd: string;
	readonly probe: Probe;
}

interface LaunchContext {
	readonly env: EnvVars;
	/** The repo cwd; only opted-in project entries launch here. */
	readonly cwd: string;
	/** Where every other launch starts (`HostHealthPorts.launchCwd`). */
	readonly launchCwd: string;
	/** The repo's directories; a project entry must not run a file in one. */
	readonly repoDirs: readonly string[];
	readonly realpath: (path: string) => string;
	/** A repo file that can redirect a package runner (`TrustOptions`). */
	readonly packageShadow: string | null;
	readonly probe: Probe;
}

async function hostReport(
	found: Found,
	label: string,
	input: HostHealthInput,
	launch: LaunchContext,
): Promise<HostLaunchReport> {
	const { target } = found;
	const fix = addFix(target.host, target.scope);
	const base = {
		host: target.host,
		label,
		scope: target.scope,
		path: target.path,
	};
	const broken = (check: HealthCheck<HostCheckId>): HostLaunchReport => ({
		...base,
		command: null,
		handshakeMs: null,
		status: check.status,
		checks: [check],
	});

	if (found.kind === "ignored") {
		return broken({
			id: "config",
			status: "fail",
			message: `${label} never reads MCP servers from ${target.path}, so this entry is never launched; remove it there`,
			fix,
		});
	}
	if (found.kind === "unreadable") {
		return broken({
			id: "config",
			status: "fail",
			message: `cannot read maina's entry: ${found.reason}`,
			fix: `\${EDITOR:-vi} ${target.path}`,
		});
	}
	const spec = launchSpecOf(found.entry);
	if (!spec.ok) {
		return broken({ id: "config", status: "fail", message: spec.error, fix });
	}
	const command = [spec.value.command, ...spec.value.args];
	const config: HealthCheck<HostCheckId> = {
		id: "config",
		status: "pass",
		message: `maina entry in ${target.path}`,
	};
	const trusted =
		target.scope !== "project" ||
		trustedProjectLaunch(spec.value, launch.repoDirs, launch);
	if (!trusted && input.launchProject !== true) {
		const shadow = isPackageRunnerLauncher(spec.value)
			? launch.packageShadow
			: null;
		return {
			...base,
			command,
			handshakeMs: null,
			status: "skipped",
			checks: [
				config,
				{
					id: "launch",
					status: "skipped",
					message: shadow === null ? SKIPPED_REASON : shadowedReason(shadow),
					fix: LAUNCH_PROJECT_FIX,
				},
			],
		};
	}
	const outcome = await launch.probe(
		spec.value,
		launch.env,
		trusted ? launch.launchCwd : launch.cwd,
	);
	const checks: HealthCheck<HostCheckId>[] = [
		config,
		...evaluateLaunch(outcome, input.version, fix),
	];
	return {
		...base,
		command,
		handshakeMs: outcome.kind === "ready" ? outcome.handshakeMs : null,
		status: worst(checks),
		checks,
	};
}

/** Launch every configured entry and check the runtime once. */
export async function checkHostHealth(
	input: HostHealthInput,
	ports: HostHealthPorts,
): Promise<HostHealth> {
	const { ctx } = input;
	const env = launchEnv(input.platform, ctx.home, input.inheritedEnv);
	const registry = buildClientRegistry(ctx);
	const found = findEntries(ctx, ports.readFile);
	// A stray entry is only broken when the host has no entry it does read.
	const wired = new Set(
		found.filter((f) => f.kind === "entry").map((f) => f.target.host),
	);
	const cwd = ports.realpath(ctx.cwd);
	const [repoRoot, policy] = await Promise.all([
		ports.repoRoot(ctx.cwd),
		ports.loadPolicy(ctx.cwd),
	]);
	const repoDirs = [ctx.cwd, cwd];
	const realRoot = repoRoot === null ? null : ports.realpath(repoRoot);
	if (repoRoot !== null && realRoot !== null) {
		repoDirs.push(repoRoot, realRoot);
	}
	const lookups = [
		[ctx.cwd, repoRoot],
		[cwd, realRoot],
	] as const;
	const packageShadow =
		lookups
			.flatMap(([dir, root]) => localCliCopies(dir, root))
			.find((copy) => ports.listDir(copy) !== null) ??
		lookups
			.flatMap(([dir, root]) => localNpmrcs(dir, root))
			.find((npmrc) => ports.readFile(npmrc) !== null) ??
		null;
	const launch: LaunchContext = {
		env: env.env,
		cwd: ctx.cwd,
		launchCwd: ports.launchCwd,
		repoDirs,
		realpath: ports.realpath,
		packageShadow,
		probe: ports.probe,
	};

	const hosts = await Promise.all(
		found.map(async (f) => {
			const report = await hostReport(
				f,
				registry[f.target.host].label,
				input,
				launch,
			);
			return f.kind === "ignored" && wired.has(f.target.host)
				? demote(report)
				: report;
		}),
	);

	const mainaDir = join(ctx.cwd, ".maina");
	const policyFile = join(mainaDir, "policy.json");
	const modelDir = join(ctx.home, ".maina", "models");
	const models = ports.listDir(modelDir);
	// Codex runs maina's PreToolUse hook for apply_patch but ignores its deny.
	const codex = codexApplyPatchCheck(
		codexHookFiles(ctx, repoRoot).map((path) => ({
			path,
			text: ports.readFile(path),
		})),
	);
	const runtime: HealthCheck<RuntimeCheckId>[] = [
		rootCheck(
			cwd,
			repoRoot === null ? null : ports.realpath(repoRoot),
			ports.listDir(mainaDir) !== null,
		),
		policyCheck(policy, policyFile, ports.readFile(policyFile) !== null),
		modelCheck(
			models !== null && models.length > 0
				? { state: "present", dir: modelDir }
				: { state: "absent", dir: modelDir },
		),
		...(codex === null ? [] : [codex]),
	];

	const all = [...hosts.flatMap((h) => h.checks), ...runtime];
	return {
		ok: worst(all) !== "fail",
		launchEnv: { mode: env.mode, PATH: env.env.PATH ?? "" },
		hosts,
		runtime,
	};
}

/** A stray entry beside one the host reads is clutter; that one gets checked. */
function demote(report: HostLaunchReport): HostLaunchReport {
	const checks = report.checks.map(
		({ fix: _fix, ...c }): HealthCheck<HostCheckId> => ({
			...c,
			status: "warn",
		}),
	);
	return { ...report, status: "warn", checks };
}
