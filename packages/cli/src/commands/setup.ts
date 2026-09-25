/**
 * `maina setup` — Magic UX wizard for first-time + reconfiguration setup.
 *
 * Replaces the old `init`-orchestrator setup. This command consolidates
 * detection, AI tailoring, scaffolding, and a verify dry-run into a single
 * sub-60s flow. `init` remains the CI primitive for raw bootstrap; `setup`
 * is the developer-facing front door.
 *
 * Pipeline: preflight → detect → infer (AI) → scaffold → verify.
 *
 * Modes:
 * - **fresh**: no `.maina/constitution.md`. Generates everything.
 * - **update**: existing constitution; re-tailor + merge into managed regions.
 * - **reset**: explicit `--reset`; backs up `.maina/` then runs fresh.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { confirm, intro, isCancel, log, outro, spinner } from "@clack/prompts";
import {
	buildUsageEvent,
	captureUsage,
	isChannelEnabled,
	scaffold,
	VERSION,
} from "@mainahq/core";
import { Command } from "commander";
import { processEnv } from "../env";
import { nodeHostFs } from "../hosts/apply";
import { buildMainaEntry } from "../hosts/entry";
import { hostPathContext, runSetupHosts } from "../hosts/index";
import { EXIT_CONFIG_ERROR, EXIT_PASSED } from "../json";
import { applyOps, snapshotFiles } from "../onboarding/apply";
import {
	describeMigrationChange,
	type MigrationReport,
	migrate1x,
} from "../onboarding/migrate-1x";
import { nodeOnboardingFs } from "../onboarding/node-fs";
import {
	onboardingTargets,
	type PlanOptions,
	planOnboarding,
} from "../onboarding/plan";
import {
	type AgentKind,
	ALL_AGENTS,
	anonymizeStack,
	assembleStackContext,
	degradedBanner,
	deploySkills,
	deviceFingerprint,
	isTelemetryOptedOut,
	newSetupId,
	recoveryCommand,
	renderFileLayoutSection,
	renderWorkflowSection,
	resolveSetupAI,
	type SetupAIMetadata,
	type SetupAIResult,
	type SetupAISource,
	type SetupDegradedReason,
	type SetupTelemetryAISource,
	type SetupTelemetryEvent,
	type SetupTelemetryPhase,
	type StackContext,
	sendSetupTelemetry,
	summarizeRepo,
} from "../onboarding/setup/index";
import { telemetryContext } from "../ports";
import {
	jsonEmitter,
	noopEmitter,
	type PhaseStatus,
	type SetupEmitter,
} from "./setup-emitter";
import { type SeedWikiResult, seedWiki } from "./setup-wiki";
import { verifyAction } from "./verify";

const CLI_VERSION = VERSION;

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Host agent detected from the environment. Reported in `SetupResult`; the
 * wizard itself does not branch on it.
 */
type AgentEnvironment =
	| "claude-code"
	| "cursor"
	| "windsurf"
	| "cline"
	| "continue"
	| "copilot"
	| "roo"
	| "amazon-q"
	| "zed"
	| "aider"
	| "generic";

export type SetupMode = "fresh" | "update" | "reset";

export interface VerifyFinding {
	file: string;
	line?: number;
	message: string;
}

interface SetupResult {
	mode: SetupMode;
	environment: AgentEnvironment;
	stack: StackContext;
	/** `"skipped"` when an existing constitution was kept: no AI call ran. */
	aiSource: SetupTelemetryAISource;
	/** Null when the AI call was skipped. */
	aiMetadata: SetupAIMetadata | null;
	constitutionWritten: boolean;
	agentFilesWritten: string[];
	agentFilesWarnings: string[];
	/** Global host config files maina was merged into (e.g. Codex). */
	hostConfigsWritten: string[];
	/** What the 1.x migration changed (stale MCP entries) and skipped. */
	migration: MigrationReport;
	verifyFinding: VerifyFinding | null;
	verifyClean: boolean;
	verifyRan: boolean;
	durationMs: number;
	degraded: boolean;
	wikiInitialized: boolean;
	wikiPages: number | null;
	wikiBackgrounded: boolean;
	wikiSkipped: "empty-repo" | "user-kept" | null;
	dirtyWorkingTree: boolean;
	gitInitialized: boolean;
	bailed: boolean;
	bailReason: string | null;
	/**
	 * Telemetry delivery status. `"skipped"` when the user opted out (flag,
	 * env var, or `.maina/config.json`); `true` on HTTP 2xx; `false` when the
	 * best-effort POST failed (offline, 4xx/5xx, timeout). Never throws.
	 */
	telemetrySent: boolean | "skipped";
}

export interface SetupActionOptions {
	cwd?: string;
	mode?: SetupMode;
	yes?: boolean;
	agents?: AgentKind[] | null;
	/** Also write the retired 1.x agent files (`--legacy-agents`). */
	legacyAgents?: boolean;
	/**
	 * Non-interactive mode for host plugins (`--plugin`): writes only
	 * `.maina/` and managed regions/keys of files that already exist.
	 */
	plugin?: boolean;
	/**
	 * Register maina in the global config of installed hosts that setup
	 * does not wire through a project file (Codex, Windsurf, Zed, …).
	 * Off unless given: the CLI passes the real home, tests a fake one.
	 * Ignored in plugin mode, which never creates files outside `.maina/`.
	 * Also where the 1.x migration looks for stale global entries, in
	 * plugin mode too: it only ever edits or removes maina's own entry.
	 */
	globalHosts?: { readonly home: string };
	ci?: boolean;
	json?: boolean;
	/**
	 * Telemetry opt-out. `false` = explicit `--no-telemetry`; `true`/unset =
	 * let env var + config decide (see `isTelemetryOptedOut`).
	 */
	telemetry?: boolean;
	forceAISource?: SetupAISource;
	deps?: SetupActionDeps;
	/** Optional emitter override (DI for tests). Auto-selected from `ci` otherwise. */
	emitter?: SetupEmitter;
	/**
	 * Whether the user opted in to the `usage` channel (FR-PRIV-1). Default:
	 * the effective collection config for `cwd`. Tests inject it.
	 */
	telemetryConsent?: (cwd: string) => Promise<boolean>;
	/** Override the cloud POST for tests. Default: real `sendSetupTelemetry`. */
	sendTelemetry?: typeof sendSetupTelemetry;
	/** Override the cloud URL (tests / staging). */
	cloudUrl?: string;
}

/**
 * Spinner shape — minimum surface needed by the wizard.
 */
export interface SpinnerLike {
	start: (msg?: string) => void;
	stop: (msg?: string) => void;
}

/**
 * Logger surface compatible with `@clack/prompts.log`.
 */
export interface SetupLogger {
	info: (message: string) => void;
	error: (message: string) => void;
	warning: (message: string) => void;
	success: (message: string) => void;
	message: (message: string) => void;
	step: (message: string) => void;
}

/**
 * Dependency injection — all I/O the wizard performs is overridable so the
 * action can be tested without touching the real network or filesystem AI.
 */
export interface SetupActionDeps {
	intro: (title?: string) => void;
	outro: (message?: string) => void;
	log: SetupLogger;
	spinner: () => SpinnerLike;
	/** Override whether the cwd is a git repo. Default: checks `.git` exists. */
	isGitRepo?: (cwd: string) => boolean;
	/**
	 * Initialize a git repo in `cwd`. Default: spawns `git init`.
	 * Returns true on success.
	 */
	gitInit?: (cwd: string) => Promise<boolean>;
	/** Returns true if working tree is dirty. Default: spawns `git status`. */
	isDirty?: (cwd: string) => Promise<boolean>;
	/** Override AI resolution. */
	resolveAI?: typeof resolveSetupAI;
	/** Override stack assembly. */
	assembleStack?: typeof assembleStackContext;
	/** Override verify run. Returns null if verify is unavailable. */
	runVerify?: (
		cwd: string,
	) => Promise<{ findings: VerifyFinding[]; clean: boolean } | null>;
	/** Interactive confirm hook (used for "not a git repo? init?", "resume vs reset?"). */
	confirm?: (opts: { message: string; initial?: boolean }) => Promise<boolean>;
	/** Override the wiki seed step. Default: real `seedWiki` from `./setup-wiki`. */
	seedWiki?: (opts: {
		cwd: string;
		stackIsEmpty: boolean;
		wikiAlreadyPresent: boolean;
		interactive: boolean;
		yes: boolean;
		timeoutMs?: number;
	}) => Promise<SeedWikiResult>;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const NOOP_LOGGER: SetupLogger = {
	info: () => {},
	error: () => {},
	warning: () => {},
	success: () => {},
	message: () => {},
	step: () => {},
};

const NOOP_SPINNER = (): SpinnerLike => ({ start: () => {}, stop: () => {} });

// ── Environment detection ────────────────────────────────────────────────────

export function detectEnvironment(): AgentEnvironment {
	const env = process.env;
	if (env.CLAUDE_CODE || env.CLAUDE_PROJECT_DIR) return "claude-code";
	if (Object.keys(env).some((k) => k.startsWith("CURSOR_"))) return "cursor";
	if (Object.keys(env).some((k) => k.startsWith("CODEIUM_"))) return "windsurf";
	if (Object.keys(env).some((k) => k.startsWith("GITHUB_COPILOT_")))
		return "copilot";
	if (Object.keys(env).some((k) => k.startsWith("AWS_"))) return "amazon-q";
	if (Object.keys(env).some((k) => k.startsWith("AIDER_"))) return "aider";
	return "generic";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Decide whether CI mode applies. Precedence:
 *   1. Explicit `--ci` (or programmatic `ci: true`) → always CI.
 *   2. `CI` env var truthy (`true`, `1`, `yes`, anything non-falsy) → CI.
 *   3. Otherwise interactive.
 *
 * `ci: false` is treated identically to `ci: undefined`: explicit-false does
 * NOT override the env var, since CI runners always set `CI=true` and a user
 * who never passed the flag almost certainly wants non-interactive output.
 */
export function resolveCiMode(
	opts: { ci?: boolean },
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (opts.ci === true) return true;
	const ciVar = env.CI;
	if (typeof ciVar === "string") {
		const v = ciVar.trim().toLowerCase();
		if (v.length > 0 && v !== "0" && v !== "false" && v !== "no") {
			return true;
		}
	}
	return false;
}

/**
 * Build the User-Agent header for cloud setup calls. CI runs get a separate
 * `maina-ci/*` prefix so the cloud `/v1/setup` endpoint can apply its own
 * rate-limit bucket without throttling interactive users.
 */
export function userAgent(ci: boolean): string {
	return `${ci ? "maina-ci" : "maina"}/${CLI_VERSION}`;
}

function defaultIsGitRepo(cwd: string): boolean {
	return existsSync(join(cwd, ".git"));
}

async function defaultGitInit(cwd: string): Promise<boolean> {
	try {
		const proc = Bun.spawn(["git", "init"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

async function defaultIsDirty(cwd: string): Promise<boolean> {
	try {
		const proc = Bun.spawn(["git", "status", "--porcelain"], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		return output.trim().length > 0;
	} catch {
		return false;
	}
}

async function defaultConfirm(opts: {
	message: string;
	initial?: boolean;
}): Promise<boolean> {
	const result = await confirm({
		message: opts.message,
		initialValue: opts.initial,
	});
	if (isCancel(result)) return false;
	return result === true;
}

/**
 * Adapter around `verifyAction` that pulls the first-finding "wow" hook out
 * of the JSON envelope. Returns null when verify cannot run (e.g. no git,
 * tooling missing) — the wizard surfaces a friendly message instead.
 */
async function defaultRunVerify(
	cwd: string,
): Promise<{ findings: VerifyFinding[]; clean: boolean } | null> {
	try {
		const result = await verifyAction({
			cwd,
			all: true,
			json: true,
			base: "main",
		});
		const findings: VerifyFinding[] = [];
		if (result.json) {
			try {
				const parsed = JSON.parse(result.json) as {
					findings?: Array<{ file: string; line?: number; message: string }>;
					syntaxErrors?: Array<{ file: string; line: number; message: string }>;
				};
				for (const f of parsed.findings ?? []) {
					findings.push({ file: f.file, line: f.line, message: f.message });
				}
				for (const e of parsed.syntaxErrors ?? []) {
					findings.push({ file: e.file, line: e.line, message: e.message });
				}
			} catch {}
		}
		return { findings, clean: result.passed && findings.length === 0 };
	} catch {
		return null;
	}
}

function detectMode(cwd: string, opts: SetupActionOptions): SetupMode {
	if (opts.mode) return opts.mode;
	if (opts.cwd === undefined && opts.mode === undefined) {
		// fall through to filesystem check below
	}
	const constitutionPath = join(cwd, ".maina", "constitution.md");
	return existsSync(constitutionPath) ? "update" : "fresh";
}

/**
 * Move `.maina/` to `.maina.bak.<timestamp>/` so `--reset` is recoverable.
 * Returns the backup path, or null if no `.maina/` existed.
 */
function backupMaina(cwd: string): string | null {
	const src = join(cwd, ".maina");
	if (!existsSync(src)) return null;
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const dest = join(cwd, `.maina.bak.${ts}`);
	try {
		renameSync(src, dest);
		return dest;
	} catch {
		// If rename fails (cross-device etc.), fall back to recursive copy + remove.
		try {
			copyRecursive(src, dest);
			rmSync(src, { recursive: true, force: true });
			return dest;
		} catch {
			return null;
		}
	}
}

function copyRecursive(src: string, dest: string): void {
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(src)) {
		const s = join(src, entry);
		const d = join(dest, entry);
		const st = statSync(s);
		if (st.isDirectory()) {
			copyRecursive(s, d);
		} else {
			writeFileSync(d, readFileSync(s));
		}
	}
}

// ── Core Action ──────────────────────────────────────────────────────────────

/**
 * Run the setup wizard.
 *
 * Always returns a `SetupResult`. Degraded AI is not a failure — the wizard
 * still scaffolds files. Hard bails (no git + non-interactive) set
 * `bailed=true` and skip downstream phases.
 */
export async function setupAction(
	options: SetupActionOptions = {},
	depsArg?: SetupActionDeps,
): Promise<SetupResult> {
	const startedAt = Date.now();
	const cwd = options.cwd ?? process.cwd();
	const ci = resolveCiMode(options);
	const ciOrJson = ci || options.json === true;
	const interactive =
		!ciOrJson && options.yes !== true && options.plugin !== true;
	const baseEmitter: SetupEmitter =
		options.emitter ?? (ciOrJson ? jsonEmitter() : noopEmitter());
	// Capture every phase event for sub-task 8 telemetry while still passing
	// it through to the underlying emitter (JSON stdout in CI, no-op in TTY).
	const phaseRecords: SetupTelemetryPhase[] = [];
	const emitter: SetupEmitter = {
		phase: (event) => {
			phaseRecords.push(extractPhase(event));
			baseEmitter.phase(event);
		},
		done: (event) => {
			phaseRecords.push(extractPhase(event));
			baseEmitter.done(event);
		},
	};
	const baseDeps: SetupActionDeps =
		depsArg ?? options.deps ?? ({} as SetupActionDeps);
	const deps: Required<
		Pick<
			SetupActionDeps,
			| "intro"
			| "outro"
			| "log"
			| "spinner"
			| "isGitRepo"
			| "gitInit"
			| "isDirty"
			| "resolveAI"
			| "assembleStack"
			| "runVerify"
			| "confirm"
			| "seedWiki"
		>
	> = {
		intro: baseDeps.intro ?? (ciOrJson ? () => {} : intro),
		outro: baseDeps.outro ?? (ciOrJson ? () => {} : outro),
		log: baseDeps.log ?? (ciOrJson ? NOOP_LOGGER : log),
		spinner: baseDeps.spinner ?? (ciOrJson ? NOOP_SPINNER : spinner),
		isGitRepo: baseDeps.isGitRepo ?? defaultIsGitRepo,
		gitInit: baseDeps.gitInit ?? defaultGitInit,
		isDirty: baseDeps.isDirty ?? defaultIsDirty,
		resolveAI: baseDeps.resolveAI ?? resolveSetupAI,
		assembleStack: baseDeps.assembleStack ?? assembleStackContext,
		runVerify: baseDeps.runVerify ?? defaultRunVerify,
		confirm: baseDeps.confirm ?? defaultConfirm,
		seedWiki: baseDeps.seedWiki ?? seedWiki,
	};

	const result: SetupResult = {
		mode: "fresh",
		environment: detectEnvironment(),
		stack: emptyStack(),
		aiSource: "degraded",
		aiMetadata: {
			source: "degraded",
			attemptedSources: ["degraded"],
			durationMs: 0,
		},
		constitutionWritten: false,
		agentFilesWritten: [],
		agentFilesWarnings: [],
		hostConfigsWritten: [],
		migration: { changes: [], skipped: [] },
		verifyFinding: null,
		verifyClean: false,
		verifyRan: false,
		durationMs: 0,
		degraded: false,
		wikiInitialized: false,
		wikiPages: null,
		wikiBackgrounded: false,
		wikiSkipped: null,
		dirtyWorkingTree: false,
		gitInitialized: false,
		bailed: false,
		bailReason: null,
		telemetrySent: "skipped",
	};

	// ── Phase 0: preflight ──────────────────────────────────────────────────
	if (!deps.isGitRepo(cwd)) {
		if (!interactive) {
			result.bailed = true;
			result.bailReason = "not_a_git_repo";
			deps.log.error(
				"Not a git repository. Run `git init` first or rerun without --yes/--ci to be prompted.",
			);
			emitter.phase({
				phase: "preflight",
				status: "error",
				reason: "not_a_git_repo",
			});
			finalizeEmit(emitter, result, startedAt, ci);
			result.durationMs = Date.now() - startedAt;
			await dispatchTelemetry(result, {
				cwd,
				ci,
				phases: phaseRecords,
				options,
			});
			return result;
		}
		const proceed = await deps.confirm({
			message: "This is not a git repository. Run `git init` here?",
			initial: true,
		});
		if (!proceed) {
			result.bailed = true;
			result.bailReason = "not_a_git_repo";
			deps.log.warning("Skipping setup. Run `git init` then `maina setup`.");
			emitter.phase({
				phase: "preflight",
				status: "error",
				reason: "user_declined_git_init",
			});
			finalizeEmit(emitter, result, startedAt, ci);
			result.durationMs = Date.now() - startedAt;
			await dispatchTelemetry(result, {
				cwd,
				ci,
				phases: phaseRecords,
				options,
			});
			return result;
		}
		const ok = await deps.gitInit(cwd);
		if (!ok) {
			result.bailed = true;
			result.bailReason = "git_init_failed";
			deps.log.error("`git init` failed. Run it manually then retry.");
			emitter.phase({
				phase: "preflight",
				status: "error",
				reason: "git_init_failed",
			});
			finalizeEmit(emitter, result, startedAt, ci);
			result.durationMs = Date.now() - startedAt;
			await dispatchTelemetry(result, {
				cwd,
				ci,
				phases: phaseRecords,
				options,
			});
			return result;
		}
		result.gitInitialized = true;
	}
	emitter.phase({
		phase: "preflight",
		status: "ok",
		gitInitialized: result.gitInitialized,
	});

	// Mode resolution (after git is guaranteed) — handles partial `.maina/`.
	let mode = detectMode(cwd, options);
	if (options.mode === "reset") {
		mode = "reset";
	}
	const constitutionExists = existsSync(join(cwd, ".maina", "constitution.md"));
	const mainaExists = existsSync(join(cwd, ".maina"));

	if (mode === "reset") {
		const backup = backupMaina(cwd);
		if (backup !== null) {
			deps.log.info(`Backed up existing .maina/ → ${backup}`);
		}
		mode = "fresh";
	} else if (mainaExists && !constitutionExists && options.mode === undefined) {
		// Partial `.maina/` — ask user (or auto-resume in non-interactive).
		if (interactive) {
			const reset = await deps.confirm({
				message:
					".maina/ exists but constitution.md is missing. Reset and start fresh? (No = resume)",
				initial: false,
			});
			if (reset) {
				const backup = backupMaina(cwd);
				if (backup !== null) deps.log.info(`Backed up → ${backup}`);
				mode = "fresh";
			} else {
				mode = "fresh"; // resume = treat as fresh; managed regions will merge
			}
		} else {
			// Non-interactive: resume.
			mode = "fresh";
		}
	}
	result.mode = mode;

	// Working-tree dirty check — non-blocking, surfaced in summary.
	result.dirtyWorkingTree = await deps.isDirty(cwd).catch(() => false);

	// ── Phase 1: detect ─────────────────────────────────────────────────────
	const sp1 = deps.spinner();
	sp1.start("Detecting your project…");
	const stackResult = await deps.assembleStack(cwd);
	if (!stackResult.ok) {
		sp1.stop("Detection failed.");
		deps.log.error(`Could not assemble stack context: ${stackResult.error}`);
		result.bailed = true;
		result.bailReason = "stack_detection_failed";
		emitter.phase({
			phase: "detect",
			status: "error",
			reason: stackResult.error,
		});
		finalizeEmit(emitter, result, startedAt, ci);
		result.durationMs = Date.now() - startedAt;
		await dispatchTelemetry(result, {
			cwd,
			ci,
			phases: phaseRecords,
			options,
		});
		return result;
	}
	result.stack = stackResult.value;
	sp1.stop(formatDetected(result.stack));
	emitter.phase({
		phase: "detect",
		status: "ok",
		languages: result.stack.languages,
		frameworks: result.stack.frameworks,
		packageManager: result.stack.packageManager,
		linters: result.stack.linters,
		testRunners: result.stack.testRunners,
		isEmpty: result.stack.isEmpty,
	});

	// ── Phase 2: infer (AI) ─────────────────────────────────────────────────
	// Setup never overwrites an existing constitution (`--reset` has moved
	// `.maina/` aside by now), so generating one would be thrown away: skip
	// the AI call. Same readable-file check as after apply below.
	const onboardingFs = nodeOnboardingFs(cwd);
	const kept = onboardingFs.read(".maina/constitution.md");
	let constitutionText: string;
	if (kept.ok && kept.value !== null) {
		constitutionText = kept.value;
		result.aiSource = "skipped";
		result.aiMetadata = null;
		deps.log.info(
			"Keeping .maina/constitution.md (run `maina setup --reset` to regenerate it).",
		);
		emitter.phase({
			phase: "infer",
			status: "skipped",
			reason: "constitution_exists",
		});
	} else {
		const sp2 = deps.spinner();
		sp2.start("Generating tailored constitution…");
		const repoSummary = await summarizeRepo(cwd, result.stack);
		const aiResolveOptions: Parameters<typeof resolveSetupAI>[0] = {
			cwd,
			env: processEnv,
			stack: result.stack,
			repoSummary,
			fingerprint: deviceFingerprint(),
			userAgent: userAgent(ci),
		};
		if (options.forceAISource !== undefined) {
			aiResolveOptions.forceSource = options.forceAISource;
		}
		let ai: SetupAIResult;
		try {
			ai = await deps.resolveAI(aiResolveOptions);
		} catch (e) {
			sp2.stop("AI resolution failed.");
			deps.log.error(
				`AI resolution threw: ${e instanceof Error ? e.message : String(e)}`,
			);
			result.bailed = true;
			result.bailReason = "ai_resolve_failed";
			emitter.phase({
				phase: "infer",
				status: "error",
				reason: e instanceof Error ? e.message : String(e),
			});
			finalizeEmit(emitter, result, startedAt, ci);
			result.durationMs = Date.now() - startedAt;
			await dispatchTelemetry(result, {
				cwd,
				ci,
				phases: phaseRecords,
				options,
			});
			return result;
		}
		result.aiSource = ai.source;
		result.aiMetadata = ai.metadata;
		result.degraded = ai.source === "degraded";
		emitter.phase({
			phase: "infer",
			status: result.degraded ? "degraded" : "ok",
			aiSource: ai.source,
			attemptedSources: ai.metadata.attemptedSources,
			durationMs: ai.metadata.durationMs,
		});

		if (result.degraded) {
			const reason: SetupDegradedReason =
				ai.metadata.reason ?? "ai_unavailable";
			const recovery = recoveryCommand(reason);
			deps.log.warning(degradedBanner(reason));
			deps.log.info(`→ ${recovery}`);
			writeDegradedLogEntry(cwd, {
				reason,
				reasonDetail: ai.metadata.reasonDetail,
				retryAt: ai.metadata.retryAt,
				recovery,
			});
		}

		if (ai.source === "host") {
			// Host delegation: the prompt has already been emitted to stdout for
			// the host AI to fulfill. For now, fall back to the degraded text so
			// the wizard can complete; sub-task 6/7 will tighten this once the
			// host round-trip is wired through.
			sp2.stop("Awaiting host AI response — using offline starter for now.");
			constitutionText = buildHostFallbackConstitution(result.stack);
		} else {
			sp2.stop(`Constitution ready (${ai.source}).`);
			constitutionText = ai.text;
		}
		// Enforce Wave 2 acceptance §6.2: every generated constitution — tailor,
		// cloud, BYOK, degraded, host-fallback — MUST ship with the two required
		// sections. Cloud returns raw LLM text that sometimes omits them; rather
		// than retrying through tailor (expensive + requires a separate prompt
		// contract with the gateway), we deterministically append any missing
		// section from the shared renderer so file-layout discipline lands in
		// every repo regardless of tier.
		constitutionText = ensureRequiredSections(constitutionText, result.stack);
	}

	// ── Phase 3: scaffold ───────────────────────────────────────────────────
	const sp3 = deps.spinner();
	sp3.start("Scaffolding files…");

	// Shared `.maina/` skeleton (prompts, features/.gitkeep, cache/,
	// config.yml). Single source of truth used by both `init` and `setup`
	// — closes G13 and keeps the two commands from drifting.
	const scaffoldResult = await scaffold({
		cwd,
		withPrompts: true,
		withConstitutionStub: false,
	});
	if (!scaffoldResult.ok) {
		// Scaffold failures are bailable: without `.maina/` we can't write
		// the constitution. Surface the error and exit like constitution
		// write failures below.
		sp3.stop("Scaffold failed.");
		deps.log.error(`Could not scaffold .maina/: ${scaffoldResult.error}`);
		result.bailed = true;
		result.bailReason = "scaffold_failed";
		emitter.phase({
			phase: "scaffold",
			status: "error",
			reason: scaffoldResult.error,
		});
		finalizeEmit(emitter, result, startedAt, ci);
		result.durationMs = Date.now() - startedAt;
		await dispatchTelemetry(result, {
			cwd,
			ci,
			phases: phaseRecords,
			options,
		});
		return result;
	}

	// 1.x migration: stale `bunx`/`npx @mainahq/cli --mcp` entries get
	// today's launcher, or go where no host reads them. Before the plan, so
	// the plan sees the migrated files. Idempotent; plugin mode runs it too.
	const mcpEntry = buildMainaEntry();
	const home = options.globalHosts?.home;
	result.migration = migrate1x({
		ctx: hostPathContext(cwd, home),
		scope: home === undefined ? "project" : "both",
		launcher: mcpEntry,
		fs: nodeHostFs(),
	});
	for (const change of result.migration.changes) {
		deps.log.info(describeMigrationChange(change, cwd));
	}

	// Single onboarding flow: snapshot the targets, plan pure file ops,
	// apply them through the fs port. Never overwrites: user files get a
	// managed region or a managed JSON key, and an existing constitution is
	// kept as-is (`--reset` backs up `.maina/` to regenerate it).
	const planOptions: PlanOptions = {
		...(options.agents ? { agents: options.agents } : {}),
		legacyAgents: options.legacyAgents === true,
		managedOnly: options.plugin === true,
	};
	const ops = planOnboarding(
		{
			stack: result.stack,
			constitution: constitutionText,
			mcpEntry,
			files: snapshotFiles(onboardingFs, onboardingTargets(planOptions)),
		},
		planOptions,
	);
	const applied = applyOps(ops, { fs: onboardingFs });
	// Require a readable regular file, not just an existing path: a
	// directory or unreadable entry here must not pass as a constitution.
	const constitutionRead = onboardingFs.read(".maina/constitution.md");
	const constitutionPresent =
		constitutionRead.ok && constitutionRead.value !== null;
	if (!applied.ok || !constitutionPresent) {
		const reason = applied.ok
			? (applied.value.skipped.find((s) => s.path === ".maina/constitution.md")
					?.reason ?? "constitution missing after apply")
			: `unsafe path: ${applied.error.path}`;
		sp3.stop("Scaffold failed.");
		deps.log.error(`Could not write constitution: ${reason}`);
		result.bailed = true;
		result.bailReason = "constitution_write_failed";
		emitter.phase({ phase: "scaffold", status: "error", reason });
		finalizeEmit(emitter, result, startedAt, ci);
		result.durationMs = Date.now() - startedAt;
		await dispatchTelemetry(result, {
			cwd,
			ci,
			phases: phaseRecords,
			options,
		});
		return result;
	}
	const report = applied.value;
	result.constitutionWritten = report.created.includes(
		".maina/constitution.md",
	);
	result.agentFilesWritten = [...report.created, ...report.merged].filter(
		(p) => p !== ".maina/constitution.md",
	);
	result.agentFilesWarnings = [
		...result.migration.skipped.map((s) => `skip ${s.path}: ${s.reason}`),
		...report.skipped.map((s) => `skip ${s.path}: ${s.reason}`),
	];
	if (report.backups.length > 0) {
		deps.log.info(`Backed up originals to ${report.backups.join(", ")}`);
	}

	// Hosts without a project MCP file only read their global config.
	if (options.globalHosts !== undefined && options.plugin !== true) {
		const hosts = await runSetupHosts({
			home: options.globalHosts.home,
			cwd,
		});
		for (const r of hosts.results) {
			if (r.error !== undefined) {
				result.agentFilesWarnings.push(`skip ${r.configPath}: ${r.error}`);
			} else if (r.action === "created" || r.action === "updated") {
				result.hostConfigsWritten.push(r.configPath);
			}
		}
	}

	// ── Skills materialisation ──────────────────────────────────────────────
	// Best-effort copy of `@mainahq/skills/<name>/SKILL.md` into
	// `.maina/skills/<name>/SKILL.md`. A missing skills package is a
	// warning, never a bail.
	const skillsResult = await deploySkills({ cwd });
	if (skillsResult.ok) {
		for (const name of skillsResult.value.deployed) {
			result.agentFilesWritten.push(`.maina/skills/${name}/SKILL.md`);
		}
		for (const w of skillsResult.value.warnings) {
			result.agentFilesWarnings.push(`skills-deploy: ${w}`);
		}
	} else {
		result.agentFilesWarnings.push(`skills-deploy: ${skillsResult.error}`);
	}

	sp3.stop(`Wrote ${result.agentFilesWritten.length} file(s).`);
	emitter.phase({
		phase: "scaffold",
		status: report.skipped.length === 0 ? "ok" : "degraded",
		constitution: result.constitutionWritten,
		files: [
			...(result.constitutionWritten ? [".maina/constitution.md"] : []),
			...result.agentFilesWritten,
		],
		warnings: result.agentFilesWarnings.length,
		migrated: result.migration.changes.length,
	});

	// ── Phase 3.5: seed wiki ────────────────────────────────────────────────
	const wikiAlreadyPresent = existsSync(join(cwd, ".maina", "wiki"));
	const wikiSeedResult = await deps.seedWiki({
		cwd,
		stackIsEmpty: result.stack.isEmpty,
		wikiAlreadyPresent,
		interactive,
		yes: options.yes === true,
	});
	result.wikiInitialized = wikiSeedResult.ran && wikiSeedResult.error === null;
	result.wikiPages = wikiSeedResult.pages;
	result.wikiBackgrounded = wikiSeedResult.backgrounded;
	result.wikiSkipped = wikiSeedResult.skipped;

	// Wave 4 / G9: if the foreground race abandoned the compile, re-spawn
	// it as a detached `maina wiki init --background --depth quick` so the
	// work survives `setup` exiting. The parent process is about to return
	// and its in-process promise would otherwise be torn down.
	if (result.wikiBackgrounded) {
		kickOffBackgroundWiki(cwd);
	}
	emitter.phase({
		phase: "wiki",
		status:
			wikiSeedResult.error !== null
				? "error"
				: wikiSeedResult.skipped !== null
					? "skipped"
					: "ok",
		ran: wikiSeedResult.ran,
		skipped: wikiSeedResult.skipped,
		pages: wikiSeedResult.pages,
		backgrounded: wikiSeedResult.backgrounded,
		error: wikiSeedResult.error,
	});

	// ── Phase 4: verify ─────────────────────────────────────────────────────
	const sp4 = deps.spinner();
	sp4.start("Running maina verify…");
	let verifyOutcome: { findings: VerifyFinding[]; clean: boolean } | null;
	try {
		verifyOutcome = await deps.runVerify(cwd);
	} catch {
		verifyOutcome = null;
	}
	let verifyFindingsCount = 0;
	if (verifyOutcome === null) {
		sp4.stop("Verify skipped (no tools available yet).");
		emitter.phase({
			phase: "verify",
			status: "skipped",
			reason: "no_tools_available",
		});
	} else {
		result.verifyRan = true;
		result.verifyClean = verifyOutcome.clean;
		verifyFindingsCount = verifyOutcome.findings.length;
		if (verifyOutcome.findings.length > 0) {
			result.verifyFinding = verifyOutcome.findings[0] ?? null;
			sp4.stop(`Found ${verifyOutcome.findings.length} finding(s).`);
		} else {
			sp4.stop("All checks passed.");
		}
		emitter.phase({
			phase: "verify",
			status: "ok",
			findings: verifyFindingsCount,
			clean: result.verifyClean,
		});
	}

	// ── Summary (interactive) ───────────────────────────────────────────────
	if (interactive) {
		emitSummary(deps.log, result);
	}

	result.durationMs = Date.now() - startedAt;
	finalizeEmit(emitter, result, startedAt, ci, verifyFindingsCount);
	await dispatchTelemetry(result, {
		cwd,
		ci,
		phases: phaseRecords,
		options,
	});
	// Consent-gated PostHog usage event. `captureUsage` is a no-op unless
	// the user opted in to `usage` and the build-time key is present, so this
	// is always safe to call — but we also honour the command-level
	// `--no-telemetry` flag here, because a user who explicitly opted out
	// of the setup-specific beacon should not silently still feed PostHog.
	if (options.telemetry !== false) {
		captureUsage(
			buildUsageEvent(
				"maina.install",
				{
					mode: result.mode,
					aiSource: result.aiSource,
					degraded: result.degraded,
					tailored: isTailored(result.aiSource),
					durationMs: result.durationMs,
					bailed: result.bailed,
					bailReason: result.bailReason ?? "",
					agentFiles: result.agentFilesWritten.length,
				},
				CLI_VERSION,
			),
			telemetryContext(cwd),
		);
	}
	return result;
}

/** The `usage` channel of the effective collection config for `cwd`. */
function usageConsent(cwd: string): Promise<boolean> {
	return isChannelEnabled(telemetryContext(cwd), "usage");
}

/**
 * A constitution was generated for this repo by a real model. Host output
 * is not wired through yet, degraded is the offline starter, and skipped
 * means the existing constitution was kept.
 */
function isTailored(source: SetupTelemetryAISource): boolean {
	return source === "byok" || source === "cloud";
}

/**
 * Fire-and-forget sub-task 8 telemetry. Resolves `result.telemetrySent` to
 * `"skipped"`, `true`, or `false`. Never throws and never delays the wizard
 * beyond the configured timeout inside `sendSetupTelemetry`.
 */
async function dispatchTelemetry(
	result: SetupResult,
	ctx: {
		cwd: string;
		ci: boolean;
		phases: SetupTelemetryPhase[];
		options: SetupActionOptions;
	},
): Promise<void> {
	const consent = ctx.options.telemetryConsent ?? usageConsent;
	const optOut = isTelemetryOptedOut({
		env: process.env,
		configPath: join(ctx.cwd, ".maina", "config.json"),
		flag: ctx.options.telemetry,
		optedIn: await consent(ctx.cwd).catch(() => false),
	});
	if (optOut.optedOut) {
		result.telemetrySent = "skipped";
		return;
	}
	const event: SetupTelemetryEvent = {
		setupId: newSetupId(deviceFingerprint()),
		stack: anonymizeStack(result.stack),
		durationMs: result.durationMs,
		phases: ctx.phases,
		aiSource: result.aiSource,
		tailored: isTailored(result.aiSource),
		degraded: result.degraded,
		mainaVersion: CLI_VERSION,
		mode: result.mode,
		ci: ctx.ci,
	};
	const sender = ctx.options.sendTelemetry ?? sendSetupTelemetry;
	const sendOpts: Parameters<typeof sendSetupTelemetry>[0] = {
		cwd: ctx.cwd,
		event,
		userAgent: userAgent(ctx.ci),
	};
	if (ctx.options.cloudUrl !== undefined) {
		sendOpts.cloudUrl = ctx.options.cloudUrl;
	}
	try {
		const res = await sender(sendOpts);
		result.telemetrySent = res.sent;
	} catch {
		// Defence-in-depth: `sendSetupTelemetry` already never throws, but
		// custom senders might. Never propagate — telemetry is best-effort.
		result.telemetrySent = false;
	}
}

/**
 * Extract the minimal phase fields we ship to the cloud. Drops any
 * phase-specific payload (languages, files, reason strings, etc.) so we
 * cannot accidentally leak project details — only the phase name, its
 * status, and optional durationMs survive.
 */
function extractPhase(event: {
	phase: string;
	status: string;
	durationMs?: unknown;
}): SetupTelemetryPhase {
	const out: SetupTelemetryPhase = {
		phase: event.phase,
		status: event.status,
	};
	if (typeof event.durationMs === "number") {
		out.durationMs = event.durationMs;
	}
	return out;
}

/**
 * Emit the final `done` JSON line. Status is `"ok"` for both clean and
 * degraded completions (degraded is not a hard failure per spec); `"error"`
 * is reserved for hard bails. Findings is the verify count when verify ran.
 */
function finalizeEmit(
	emitter: SetupEmitter,
	result: SetupResult,
	startedAt: number,
	ci: boolean,
	findings = 0,
): void {
	const durationMs = Date.now() - startedAt;
	const status: PhaseStatus = result.bailed ? "error" : "ok";
	emitter.done({
		phase: "done",
		status,
		findings,
		tailored: isTailored(result.aiSource),
		aiSource: result.aiSource,
		degraded: result.degraded,
		durationMs,
		agentFiles: result.agentFilesWritten.length,
		wikiPages: result.wikiPages,
		bailed: result.bailed,
		bailReason: result.bailReason,
		mode: result.mode,
		ci,
	});
}

// ── Output helpers ───────────────────────────────────────────────────────────

function formatDetected(stack: StackContext): string {
	const lang = stack.languages[0] ?? "unknown";
	const fw = stack.frameworks[0] ?? "no framework";
	return `Detected ${lang}, ${fw}, ${stack.packageManager}.`;
}

function emitSummary(log: SetupLogger, r: SetupResult): void {
	log.step("Setup summary");
	log.message(`  Mode:            ${r.mode}`);
	log.message(`  Stack:           ${r.stack.languages.join(", ") || "(none)"}`);
	const aiSource =
		r.aiSource === "skipped"
			? "skipped (kept .maina/constitution.md)"
			: r.aiSource;
	log.message(`  AI source:       ${aiSource}`);
	if (r.degraded && r.aiMetadata?.retryAt) {
		log.message(`  Cloud retry at:  ${r.aiMetadata.retryAt}`);
	}
	log.message(
		`  Files written:   ${[
			r.constitutionWritten ? ".maina/constitution.md" : null,
			...r.agentFilesWritten,
			...r.hostConfigsWritten,
		]
			.filter(Boolean)
			.join(", ")}`,
	);
	if (r.agentFilesWarnings.length > 0) {
		log.warning(`  Warnings:        ${r.agentFilesWarnings.length}`);
		for (const w of r.agentFilesWarnings) log.message(`    - ${w}`);
	}
	if (r.verifyRan) {
		if (r.verifyClean) {
			log.success("  Verify:          all checks passed");
		} else if (r.verifyFinding) {
			log.message(
				`  Verify finding:  ${r.verifyFinding.file}${
					r.verifyFinding.line ? `:${r.verifyFinding.line}` : ""
				} — ${r.verifyFinding.message}`,
			);
		}
	} else {
		log.message("  Verify:          skipped");
	}
	log.message(`  Wiki:            ${describeWiki(r)}`);
	if (r.dirtyWorkingTree) {
		log.warning("  Working tree is dirty — review changes before committing.");
	}
	log.message("");
	log.info("Sign in with `maina login` for daily audits + higher limits.");
}

/**
 * Wave 4 / G9: fire-and-forget spawn of `maina wiki init --background
 * --depth quick` so an abandoned foreground compile continues past the
 * end of `setup`. Best-effort: any spawn failure is swallowed (we do
 * not want to fail setup because a post-hook background nudge failed).
 */
function kickOffBackgroundWiki(cwd: string): void {
	try {
		const proc = Bun.spawn(
			[
				"bun",
				"run",
				"maina",
				"wiki",
				"init",
				"--background",
				"--depth",
				"quick",
				"--json",
			],
			{
				cwd,
				stdout: "ignore",
				stderr: "ignore",
				stdin: "ignore",
			},
		);
		proc.unref?.();
	} catch {
		// Best-effort — background compile is a nicety, not a requirement.
	}
}

function describeWiki(r: SetupResult): string {
	if (r.wikiSkipped === "empty-repo") return "skipped (empty repo)";
	if (r.wikiSkipped === "user-kept") return "kept existing";
	if (r.wikiBackgrounded) {
		return "compiling in background — view later with `maina wiki serve`";
	}
	if (r.wikiPages !== null) {
		return `ready: ${r.wikiPages} pages, view with \`maina wiki serve\``;
	}
	return "(pending)";
}

function emptyStack(): StackContext {
	return {
		languages: [],
		frameworks: [],
		packageManager: "unknown",
		buildTool: null,
		linters: [],
		testRunners: [],
		cicd: [],
		repoSize: { files: 0, bytes: 0 },
		isEmpty: true,
		isLarge: false,
	};
}

/**
 * Conservative starter constitution used while host delegation is in flight.
 * Identical shape to the degraded fallback so writers downstream don't care
 * which path produced the text.
 */
/**
 * Heuristic — returns true when the CLI was launched via a package runner
 * that caches the package in a tmp directory (bunx, npx, pnpx, pnpm dlx).
 * Used to warn the user that `maina` will not be on PATH after exit.
 */
function isRunningFromPackageRunnerCache(): boolean {
	const entry = process.argv[1] ?? "";
	return /(\.bun[/\\]install[/\\]cache|[/\\]_npx[/\\]|[/\\]pnpm[/\\]dlx)/i.test(
		entry,
	);
}

function writeDegradedLogEntry(
	cwd: string,
	entry: {
		reason: SetupDegradedReason;
		reasonDetail?: string;
		retryAt?: string;
		recovery: string;
	},
): void {
	const mainaDir = join(cwd, ".maina");
	try {
		mkdirSync(mainaDir, { recursive: true });
	} catch {
		return;
	}
	const logPath = join(mainaDir, "setup.log");
	const parts = [
		new Date().toISOString(),
		"[degraded]",
		`reason=${entry.reason}`,
	];
	if (entry.reasonDetail) parts.push(`detail=${entry.reasonDetail}`);
	if (entry.retryAt) parts.push(`retryAt=${entry.retryAt}`);
	parts.push(`recovery=${JSON.stringify(entry.recovery)}`);
	const line = `${parts.join(" ")}\n`;
	try {
		const existing = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
		writeFileSync(logPath, existing + line);
	} catch {
		// ignore — log is advisory
	}
}

/**
 * Post-process any constitution text to guarantee it contains the **canonical**
 * Wave 2 §6.2 sections. An LLM that paraphrased the workflow would slip past a
 * heading-only regex check (CodeRabbit finding 2026-04-22) — so we strip any
 * existing `## Maina Workflow` / `## File Layout` block (canonical or
 * paraphrased) and re-append the template output. Idempotent: text that
 * already has the canonical sections ends up with them in the same place
 * (order-preserving via `includes`) or moved to the end (when a paraphrase
 * had to be stripped).
 */
function ensureRequiredSections(text: string, stack: StackContext): string {
	const workflowCanonical = renderWorkflowSection();
	const fileLayoutCanonical = renderFileLayoutSection({
		languages: stack.languages,
		toplevelDirs: [],
	});
	let out = text.replace(/\r\n/g, "\n");
	if (!out.endsWith("\n")) out = `${out}\n`;

	// Fast path: canonical bodies already present verbatim — preserve order.
	const hasCanonicalWorkflow = out.includes(workflowCanonical);
	const hasCanonicalFileLayout = out.includes(fileLayoutCanonical);
	if (hasCanonicalWorkflow && hasCanonicalFileLayout) return out;

	// Strip any paraphrased version of each section before appending canonical.
	if (!hasCanonicalWorkflow) {
		out = stripSection(out, "Maina Workflow");
		out = `${out.trimEnd()}\n\n${workflowCanonical}\n`;
	}
	if (!hasCanonicalFileLayout) {
		out = stripSection(out, "File Layout");
		out = `${out.trimEnd()}\n\n${fileLayoutCanonical}\n`;
	}
	return out;
}

/**
 * Remove a `## <heading>` block from `text`. Matches from the heading line up
 * to the next `##` (or end of string). No-op when the section is absent.
 */
function stripSection(text: string, heading: string): string {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(
		`(?:^|\\n)##\\s+${escaped}\\b[^\\n]*\\n[\\s\\S]*?(?=\\n##\\s|$)`,
		"m",
	);
	return text.replace(re, "");
}

function buildHostFallbackConstitution(stack: StackContext): string {
	const langs = stack.languages.join(", ") || "your stack";
	const principles = [
		"# Project Constitution",
		"",
		"> Stub authored by `maina setup` while the host AI completes the request.",
		"> Re-run `maina setup --update` once the host returns to refresh.",
		"",
		"## Stack",
		"",
		`- Languages: ${langs}`,
		`- Package manager: ${stack.packageManager}`,
		"",
		"## Principles",
		"",
		"1. Tests first.",
		"2. Small, reviewable diffs.",
		"3. Conventional commits.",
		"4. No silent failures — return `Result<T, E>`.",
		"5. Lint and type-check before push.",
		"",
	].join("\n");
	// Wave 2 acceptance criterion 6.2: every generated constitution — including
	// the host-fallback stub while delegation is in flight — must ship with the
	// `## Maina Workflow` and `## File Layout` sections. We reuse the same
	// renderers the tailor/generic paths use so AI agents that read this stub
	// still land feature artefacts under `.maina/features/…`.
	const workflow = renderWorkflowSection();
	const layout = renderFileLayoutSection({
		languages: stack.languages,
		toplevelDirs: [],
	});
	return `${principles}\n${workflow}\n\n${layout}\n`;
}

// ── Commander Command ────────────────────────────────────────────────────────

function parseAgentList(value: string): AgentKind[] {
	const valid = new Set<AgentKind>(ALL_AGENTS);
	const parts = value
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter((s) => s.length > 0);
	const out: AgentKind[] = [];
	for (const p of parts) {
		if (valid.has(p as AgentKind)) out.push(p as AgentKind);
	}
	return out;
}

/** Raw flags parsed by Commander for `maina setup` (and `maina init`). */
export interface SetupCommandOptions {
	update?: boolean;
	reset?: boolean;
	ci?: boolean;
	yes?: boolean;
	agents?: string;
	legacyAgents?: boolean;
	plugin?: boolean;
	telemetry?: boolean;
	json?: boolean;
}

/** Register the `setup` flags. Shared with the deprecated `init` alias. */
export function addSetupOptions(cmd: Command): Command {
	return cmd
		.option(
			"--update",
			"Refresh managed regions in agent files for the current stack",
		)
		.option("--reset", "Back up .maina/ and start fresh")
		.option("--ci", "Non-interactive, JSON-per-phase output (sub-task 7)")
		.option("-y, --yes", "Skip prompts, accept defaults")
		.option(
			"--agents <list>",
			"Comma-separated: agents,claude,cursor,copilot,windsurf",
		)
		.option(
			"--legacy-agents",
			"Also write retired agent files (.clinerules, .roo/, .aider.conf.yml, …)",
		)
		.option(
			"--plugin",
			"Non-interactive plugin mode: write only .maina/ and managed regions",
		)
		.option("--no-telemetry", "Opt out of anonymous setup telemetry")
		.option("--json", "Machine-readable JSON output");
}

/** Run the setup wizard for parsed CLI flags and set the exit code. */
export async function runSetupCommand(
	opts: SetupCommandOptions,
): Promise<void> {
	const ci = resolveCiMode({ ci: opts.ci === true });
	const json = opts.json === true || ci;
	let mode: SetupMode | undefined;
	if (opts.reset === true) mode = "reset";
	else if (opts.update === true) mode = "update";

	const agents =
		typeof opts.agents === "string" ? parseAgentList(opts.agents) : null;

	if (!json) intro("maina setup");

	// G1: When launched through bunx/pnpx/npx, the CLI is cached in a tmp
	// dir and vanishes after exit — AI agents that spawn subshells will not
	// find `maina` on PATH. Surface a loud notice now so the user either
	// installs globally or knows why subsequent AI calls cannot shell out.
	if (!json && isRunningFromPackageRunnerCache()) {
		log.warning(
			"Running from a package-runner cache — `maina` will not be on PATH after this command exits.",
		);
		log.info(
			"  Install globally with: `bun add -g @mainahq/cli` (or `npm install -g @mainahq/cli`).",
		);
	}

	const actionOpts: SetupActionOptions = {
		yes: opts.yes === true || opts.plugin === true,
		ci,
		json,
		telemetry: opts.telemetry !== false,
		legacyAgents: opts.legacyAgents === true,
		plugin: opts.plugin === true,
		globalHosts: { home: homedir() },
	};
	if (mode !== undefined) actionOpts.mode = mode;
	if (agents !== null) actionOpts.agents = agents;

	let result: SetupResult;
	try {
		result = await setupAction(actionOpts);
	} catch (e) {
		// CI mode: surface a structured error before crashing.
		if (ci) {
			const line = JSON.stringify({
				phase: "done",
				status: "error",
				message: e instanceof Error ? e.message : String(e),
			});
			process.stdout.write(`${line}\n`);
		}
		process.exitCode = EXIT_CONFIG_ERROR;
		return;
	}

	// Exit-code matrix:
	//   bailed=true  → 1 (hard failure: not-a-git-repo, AI throw, etc.)
	//   degraded=true (but completed) → 0 (spec: degraded ≠ failure)
	//   ok           → 0
	if (json) {
		// In CI/json mode, the per-phase emitter already wrote the `done`
		// line. Just set the exit code; do NOT print again.
		process.exitCode = result.bailed ? EXIT_CONFIG_ERROR : EXIT_PASSED;
		return;
	}

	if (result.bailed) {
		outro(`Setup did not complete: ${result.bailReason ?? "unknown"}`);
		process.exitCode = EXIT_CONFIG_ERROR;
		return;
	}
	outro(`Setup complete in ${(result.durationMs / 1000).toFixed(1)}s.`);
}

export function setupCommand(): Command {
	return addSetupOptions(
		new Command("setup").description(
			"Onboard maina: detect → tailor → scaffold → verify (idempotent)",
		),
	).action(async (opts: SetupCommandOptions) => {
		await runSetupCommand(opts);
	});
}
