/**
 * Tests for the rewritten `maina setup` wizard.
 *
 * The wizard exposes a heavily-DI'd `setupAction` so we can exercise mode
 * detection, agent flag parsing, AI source threading, and verify-finding
 * capture without touching the real network or AI providers.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentKind, SetupAIResult, StackContext } from "@mainahq/core";
import {
	buildClaudeSettingsJson,
	detectEnvironment,
	ensureClaudeSettings,
	resolveCiMode,
	type SetupActionDeps,
	type SetupActionOptions,
	setupAction,
	userAgent,
	type VerifyFinding,
} from "../setup";
import { jsonEmitter, type PhaseEvent } from "../setup-emitter";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-setup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeGitRepo(dir: string): void {
	mkdirSync(join(dir, ".git"), { recursive: true });
}

function fakeStack(overrides?: Partial<StackContext>): StackContext {
	return {
		languages: ["typescript"],
		frameworks: [],
		packageManager: "bun",
		buildTool: null,
		linters: ["biome"],
		testRunners: ["bun:test"],
		cicd: [],
		repoSize: { files: 10, bytes: 1000 },
		isEmpty: false,
		isLarge: false,
		...overrides,
	};
}

function fakeAI(
	source: SetupAIResult["source"],
	text = "# Project Constitution\n\n- TDD\n- Conventional commits\n",
): SetupAIResult {
	const meta = {
		source,
		attemptedSources: [source],
		durationMs: 1,
	};
	if (source === "host") {
		return {
			source: "host",
			delegation: { promptPath: "/tmp/p", pendingPath: "/tmp/r" } as never,
			text: null,
			metadata: meta,
		};
	}
	return { source, text, metadata: meta } as SetupAIResult;
}

function makeDeps(
	overrides?: Partial<SetupActionDeps>,
): Required<
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
		| "writeAgentFiles"
		| "runVerify"
		| "confirm"
	>
> {
	return {
		intro: () => {},
		outro: () => {},
		log: {
			info: () => {},
			error: () => {},
			warning: () => {},
			success: () => {},
			message: () => {},
			step: () => {},
		},
		spinner: () => ({ start: () => {}, stop: () => {} }),
		isGitRepo: () => true,
		gitInit: async () => true,
		isDirty: async () => false,
		resolveAI: async () => fakeAI("byok"),
		assembleStack: async () => ({ ok: true, value: fakeStack() }),
		writeAgentFiles: async () => ({
			ok: true,
			value: { written: ["AGENTS.md", "CLAUDE.md"], warnings: [] },
		}),
		runVerify: async () => ({ findings: [], clean: true }),
		confirm: async () => true,
		seedWiki: async () => ({
			ran: true,
			skipped: null,
			pages: 4,
			backgrounded: false,
			error: null,
		}),
		...overrides,
	};
}

// ── Setup ───────────────────────────────────────────────────────────────────

let tmpDir: string;
let originalTelemetryEnv: string | undefined;
let originalCiEnv: string | undefined;

beforeEach(() => {
	tmpDir = makeTmpDir();
	// Tests should never hit the real cloud. Env-opt-out is the simplest guard
	// and is independently covered by the sub-task-8 telemetry tests.
	originalTelemetryEnv = process.env.MAINA_TELEMETRY;
	process.env.MAINA_TELEMETRY = "0";
	// CI runners set CI=true, which `resolveCiMode` honours and silently flips
	// every test into ci-mode (suppressing prompts, picking maina-ci/* UA).
	// Clear it so the default test posture matches local. Tests that need
	// CI-mode behaviour pass `ci: true` explicitly.
	originalCiEnv = process.env.CI;
	delete process.env.CI;
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
	if (originalTelemetryEnv === undefined) delete process.env.MAINA_TELEMETRY;
	else process.env.MAINA_TELEMETRY = originalTelemetryEnv;
	if (originalCiEnv === undefined) delete process.env.CI;
	else process.env.CI = originalCiEnv;
});

// ── Backward-compat helpers ─────────────────────────────────────────────────
//
// These were exported by the previous setup.ts. Keep coverage so any caller
// still relying on them does not silently regress.

describe("detectEnvironment (legacy helper)", () => {
	test("returns claude-code when CLAUDE_CODE is set", () => {
		const original = process.env.CLAUDE_CODE;
		process.env.CLAUDE_CODE = "1";
		try {
			expect(detectEnvironment()).toBe("claude-code");
		} finally {
			if (original === undefined) delete process.env.CLAUDE_CODE;
			else process.env.CLAUDE_CODE = original;
		}
	});
});

describe("ensureClaudeSettings (legacy helper)", () => {
	test("creates .claude/settings.json when missing", () => {
		makeGitRepo(tmpDir);
		expect(ensureClaudeSettings(tmpDir)).toBe(true);
		const content = JSON.parse(
			readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8"),
		);
		expect(content.mcpServers.maina.command).toBe("npx");
	});

	test("buildClaudeSettingsJson produces valid JSON", () => {
		const json = JSON.parse(buildClaudeSettingsJson());
		expect(json.mcpServers.maina).toBeDefined();
	});
});

// ── Wizard: mode auto-detection ─────────────────────────────────────────────

describe("setupAction — mode detection", () => {
	test("no constitution → mode = fresh", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps();
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.mode).toBe("fresh");
	});

	test("existing constitution → mode = update", async () => {
		makeGitRepo(tmpDir);
		mkdirSync(join(tmpDir, ".maina"), { recursive: true });
		writeFileSync(join(tmpDir, ".maina", "constitution.md"), "# Existing\n");
		const deps = makeDeps();
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.mode).toBe("update");
		// Constitution gets re-tailored on update too
		expect(result.constitutionWritten).toBe(true);
	});

	test("--reset backs up .maina/ and runs fresh", async () => {
		makeGitRepo(tmpDir);
		mkdirSync(join(tmpDir, ".maina"), { recursive: true });
		writeFileSync(join(tmpDir, ".maina", "constitution.md"), "# Old\n");
		const deps = makeDeps();
		const result = await setupAction(
			{ cwd: tmpDir, mode: "reset", yes: true },
			deps,
		);
		expect(result.mode).toBe("fresh");
		const backups = readdirSync(tmpDir).filter((e) =>
			e.startsWith(".maina.bak."),
		);
		expect(backups.length).toBeGreaterThan(0);
	});

	test("partial .maina (no constitution) in non-interactive resumes as fresh", async () => {
		makeGitRepo(tmpDir);
		mkdirSync(join(tmpDir, ".maina"), { recursive: true });
		writeFileSync(join(tmpDir, ".maina", ".env"), "OPENROUTER_API_KEY=foo\n");
		const deps = makeDeps();
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.mode).toBe("fresh");
		// .env should still exist (not blown away)
		expect(existsSync(join(tmpDir, ".maina", ".env"))).toBe(true);
	});
});

// ── Wizard: AI source threading ─────────────────────────────────────────────

describe("setupAction — AI source threading", () => {
	for (const src of ["byok", "cloud", "degraded"] as const) {
		test(`aiSource=${src} flows into SetupResult`, async () => {
			makeGitRepo(tmpDir);
			const deps = makeDeps({
				resolveAI: async () => fakeAI(src),
			});
			const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
			expect(result.aiSource).toBe(src);
			expect(result.degraded).toBe(src === "degraded");
		});
	}

	test("degraded mode does not throw and still scaffolds", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({
			resolveAI: async () => fakeAI("degraded"),
		});
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.degraded).toBe(true);
		expect(result.constitutionWritten).toBe(true);
		expect(existsSync(join(tmpDir, ".maina", "constitution.md"))).toBe(true);
	});

	test("host source uses placeholder constitution but still completes", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({
			resolveAI: async () => fakeAI("host"),
		});
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.aiSource).toBe("host");
		expect(result.constitutionWritten).toBe(true);
	});
});

// ── Wizard: agent flag ──────────────────────────────────────────────────────

describe("setupAction — agents flag", () => {
	test("passes selected agents through to writeAgentFiles", async () => {
		makeGitRepo(tmpDir);
		let captured: AgentKind[] | undefined;
		const deps = makeDeps({
			writeAgentFiles: async (_cwd, _ctx, _qr, agents) => {
				captured = agents;
				return {
					ok: true,
					value: { written: ["AGENTS.md"], warnings: [] },
				};
			},
		});
		const opts: SetupActionOptions = {
			cwd: tmpDir,
			yes: true,
			agents: ["agents", "cursor"],
		};
		await setupAction(opts, deps);
		expect(captured).toEqual(["agents", "cursor"]);
	});

	test("undefined agents → writes all (writer receives undefined)", async () => {
		makeGitRepo(tmpDir);
		let captured: AgentKind[] | undefined = ["agents"];
		const deps = makeDeps({
			writeAgentFiles: async (_cwd, _ctx, _qr, agents) => {
				captured = agents;
				return { ok: true, value: { written: [], warnings: [] } };
			},
		});
		await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(captured).toBeUndefined();
	});
});

// ── Wizard: verify-finding capture ──────────────────────────────────────────

describe("setupAction — verify wow finding", () => {
	test("captures first finding when verify reports issues", async () => {
		makeGitRepo(tmpDir);
		const finding: VerifyFinding = {
			file: "src/foo.ts",
			line: 12,
			message: "no-explicit-any",
		};
		const deps = makeDeps({
			runVerify: async () => ({
				findings: [finding, { file: "src/bar.ts", line: 3, message: "other" }],
				clean: false,
			}),
		});
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.verifyRan).toBe(true);
		expect(result.verifyClean).toBe(false);
		expect(result.verifyFinding).toEqual(finding);
	});

	test("clean verify → verifyClean=true, verifyFinding=null", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({
			runVerify: async () => ({ findings: [], clean: true }),
		});
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.verifyClean).toBe(true);
		expect(result.verifyFinding).toBeNull();
	});

	test("verify unavailable → verifyRan=false (no fabrication)", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({
			runVerify: async () => null,
		});
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.verifyRan).toBe(false);
		expect(result.verifyFinding).toBeNull();
		expect(result.verifyClean).toBe(false);
	});
});

// ── Wizard: edge cases ──────────────────────────────────────────────────────

describe("setupAction — edge cases", () => {
	test("not a git repo + --yes bails cleanly", async () => {
		const deps = makeDeps({
			isGitRepo: () => false,
		});
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.bailed).toBe(true);
		expect(result.bailReason).toBe("not_a_git_repo");
		expect(result.constitutionWritten).toBe(false);
	});

	test("not a git repo + interactive 'yes' runs git init then continues", async () => {
		let initCalled = false;
		let isRepo = false;
		const deps = makeDeps({
			isGitRepo: () => isRepo,
			gitInit: async () => {
				initCalled = true;
				isRepo = true;
				return true;
			},
			confirm: async () => true,
		});
		const result = await setupAction({ cwd: tmpDir }, deps);
		expect(initCalled).toBe(true);
		expect(result.bailed).toBe(false);
		expect(result.gitInitialized).toBe(true);
	});

	test("dirty working tree is surfaced but does not block", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({
			isDirty: async () => true,
		});
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.dirtyWorkingTree).toBe(true);
		expect(result.bailed).toBe(false);
		expect(result.constitutionWritten).toBe(true);
	});

	test("agent file warnings are surfaced", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({
			writeAgentFiles: async () => ({
				ok: true,
				value: {
					written: ["AGENTS.md"],
					warnings: ["skip CLAUDE.md: read-only"],
				},
			}),
		});
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.agentFilesWarnings).toContain("skip CLAUDE.md: read-only");
	});

	test("returns durationMs", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps();
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("wiki seed result flows into SetupResult", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({
			seedWiki: async () => ({
				ran: true,
				skipped: null,
				pages: 17,
				backgrounded: false,
				error: null,
			}),
		});
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.wikiInitialized).toBe(true);
		expect(result.wikiPages).toBe(17);
		expect(result.wikiBackgrounded).toBe(false);
		expect(result.wikiSkipped).toBeNull();
	});

	test("seedWiki receives stack.isEmpty + wikiAlreadyPresent + interactive flags", async () => {
		makeGitRepo(tmpDir);
		mkdirSync(join(tmpDir, ".maina", "wiki"), { recursive: true });
		const captured: Array<{
			cwd: string;
			stackIsEmpty: boolean;
			wikiAlreadyPresent: boolean;
			interactive: boolean;
			yes: boolean;
		}> = [];
		const deps = makeDeps({
			assembleStack: async () => ({
				ok: true,
				value: fakeStack({ isEmpty: true }),
			}),
			seedWiki: async (opts) => {
				captured.push(opts);
				return {
					ran: false,
					skipped: "empty-repo",
					pages: null,
					backgrounded: false,
					error: null,
				};
			},
		});
		await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(captured.length).toBe(1);
		expect(captured[0]?.stackIsEmpty).toBe(true);
		expect(captured[0]?.wikiAlreadyPresent).toBe(true);
		expect(captured[0]?.interactive).toBe(false);
		expect(captured[0]?.yes).toBe(true);
	});

	test("backgrounded wiki seed surfaces in result", async () => {
		makeGitRepo(tmpDir);
		const deps = makeDeps({
			seedWiki: async () => ({
				ran: true,
				skipped: null,
				pages: null,
				backgrounded: true,
				error: null,
			}),
		});
		const result = await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(result.wikiBackgrounded).toBe(true);
		expect(result.wikiPages).toBeNull();
	});

	test("forceAISource flows into resolveSetupAI options", async () => {
		makeGitRepo(tmpDir);
		let receivedForce: string | undefined;
		const deps = makeDeps({
			resolveAI: async (opts) => {
				receivedForce = opts.forceSource;
				return fakeAI("degraded");
			},
		});
		await setupAction(
			{ cwd: tmpDir, yes: true, forceAISource: "degraded" },
			deps,
		);
		expect(receivedForce).toBe("degraded");
	});
});

// ── --ci non-interactive mode ───────────────────────────────────────────────

describe("resolveCiMode", () => {
	test("explicit ci:true wins regardless of env", () => {
		expect(resolveCiMode({ ci: true }, {})).toBe(true);
		expect(resolveCiMode({ ci: true }, { CI: "false" })).toBe(true);
	});

	test("CI=true env auto-enables ci when flag not set", () => {
		expect(resolveCiMode({}, { CI: "true" })).toBe(true);
		expect(resolveCiMode({}, { CI: "1" })).toBe(true);
		expect(resolveCiMode({}, { CI: "yes" })).toBe(true);
	});

	test("CI=false / 0 / no / empty → not ci", () => {
		expect(resolveCiMode({}, { CI: "false" })).toBe(false);
		expect(resolveCiMode({}, { CI: "0" })).toBe(false);
		expect(resolveCiMode({}, { CI: "no" })).toBe(false);
		expect(resolveCiMode({}, { CI: "" })).toBe(false);
		expect(resolveCiMode({}, {})).toBe(false);
	});

	test("ci:false but CI=true → still ci (env wins when flag not explicit-true)", () => {
		// Per the helper contract: only explicit ci:true forces, otherwise env
		// is consulted. ci:false in opts is indistinguishable from "not passed".
		expect(resolveCiMode({ ci: false }, { CI: "true" })).toBe(true);
	});
});

describe("userAgent", () => {
	test("returns maina-ci/<version> when ci=true", () => {
		const ua = userAgent(true);
		expect(ua.startsWith("maina-ci/")).toBe(true);
	});

	test("returns maina/<version> when ci=false", () => {
		const ua = userAgent(false);
		expect(ua.startsWith("maina/")).toBe(true);
		expect(ua.startsWith("maina-ci/")).toBe(false);
	});
});

describe("setupAction — ci mode emitter integration", () => {
	test("emits one JSON line per phase + final done line", async () => {
		makeGitRepo(tmpDir);
		const lines: string[] = [];
		const deps = makeDeps();
		await setupAction(
			{
				cwd: tmpDir,
				ci: true,
				emitter: jsonEmitter((l) => lines.push(l)),
			},
			deps,
		);
		// Phases: preflight, detect, infer, scaffold, wiki, verify, done = 7
		expect(lines.length).toBe(7);
		const phases = lines.map((l) => JSON.parse(l) as PhaseEvent);
		expect(phases.map((p) => p.phase)).toEqual([
			"preflight",
			"detect",
			"infer",
			"scaffold",
			"wiki",
			"verify",
			"done",
		]);
		const done = phases[6];
		expect(done?.phase).toBe("done");
		expect(done?.status).toBe("ok");
		expect(typeof done?.findings).toBe("number");
		expect(done?.tailored).toBe(true); // byok source = tailored
		expect(done?.aiSource).toBe("byok");
		expect(done?.mode).toBe("fresh");
		expect(done?.ci).toBe(true);
	});

	test("not_a_git_repo + ci → preflight error + done, no prompts", async () => {
		const lines: string[] = [];
		let confirmCalled = false;
		const deps = makeDeps({
			isGitRepo: () => false,
			confirm: async () => {
				confirmCalled = true;
				return true;
			},
		});
		const result = await setupAction(
			{
				cwd: tmpDir,
				ci: true,
				emitter: jsonEmitter((l) => lines.push(l)),
			},
			deps,
		);
		expect(confirmCalled).toBe(false);
		expect(result.bailed).toBe(true);
		expect(result.bailReason).toBe("not_a_git_repo");
		const events = lines.map((l) => JSON.parse(l) as PhaseEvent);
		expect(events[0]?.phase).toBe("preflight");
		expect(events[0]?.status).toBe("error");
		expect(events[0]?.reason).toBe("not_a_git_repo");
		const done = events.at(-1);
		expect(done?.phase).toBe("done");
		expect(done?.status).toBe("error");
		expect(done?.bailed).toBe(true);
	});

	test("degraded ai → done.status=ok with degraded:true (degraded ≠ failure)", async () => {
		makeGitRepo(tmpDir);
		const lines: string[] = [];
		const deps = makeDeps({
			resolveAI: async () => fakeAI("degraded"),
		});
		const result = await setupAction(
			{
				cwd: tmpDir,
				ci: true,
				emitter: jsonEmitter((l) => lines.push(l)),
			},
			deps,
		);
		expect(result.degraded).toBe(true);
		expect(result.bailed).toBe(false);
		const events = lines.map((l) => JSON.parse(l) as PhaseEvent);
		const done = events.at(-1);
		expect(done?.status).toBe("ok");
		expect(done?.degraded).toBe(true);
		expect(done?.tailored).toBe(false); // degraded ≠ tailored
		// Infer phase reports degraded status separately
		const infer = events.find((e) => e.phase === "infer");
		expect(infer?.status).toBe("degraded");
	});

	test("verify findings count flows into done.findings as integer", async () => {
		makeGitRepo(tmpDir);
		const lines: string[] = [];
		const deps = makeDeps({
			runVerify: async () => ({
				findings: [
					{ file: "a.ts", line: 1, message: "x" },
					{ file: "b.ts", line: 2, message: "y" },
					{ file: "c.ts", line: 3, message: "z" },
				],
				clean: false,
			}),
		});
		await setupAction(
			{
				cwd: tmpDir,
				ci: true,
				emitter: jsonEmitter((l) => lines.push(l)),
			},
			deps,
		);
		const events = lines.map((l) => JSON.parse(l) as PhaseEvent);
		const verify = events.find((e) => e.phase === "verify");
		expect(verify?.findings).toBe(3);
		const done = events.at(-1);
		expect(done?.findings).toBe(3);
	});

	test("--ci --reset works non-interactively", async () => {
		makeGitRepo(tmpDir);
		mkdirSync(join(tmpDir, ".maina"), { recursive: true });
		writeFileSync(join(tmpDir, ".maina", "constitution.md"), "# Old\n");
		const lines: string[] = [];
		let confirmCalled = false;
		const deps = makeDeps({
			confirm: async () => {
				confirmCalled = true;
				return true;
			},
		});
		const result = await setupAction(
			{
				cwd: tmpDir,
				ci: true,
				mode: "reset",
				emitter: jsonEmitter((l) => lines.push(l)),
			},
			deps,
		);
		expect(confirmCalled).toBe(false);
		expect(result.mode).toBe("fresh");
		expect(result.bailed).toBe(false);
		const backups = readdirSync(tmpDir).filter((e) =>
			e.startsWith(".maina.bak."),
		);
		expect(backups.length).toBeGreaterThan(0);
		// Final done line present
		const events = lines.map((l) => JSON.parse(l) as PhaseEvent);
		expect(events.at(-1)?.phase).toBe("done");
	});

	test("CI=true env auto-enables ci when --ci flag not passed", async () => {
		makeGitRepo(tmpDir);
		const lines: string[] = [];
		const deps = makeDeps();
		const originalCI = process.env.CI;
		process.env.CI = "true";
		try {
			await setupAction(
				{
					cwd: tmpDir,
					emitter: jsonEmitter((l) => lines.push(l)),
				},
				deps,
			);
		} finally {
			if (originalCI === undefined) delete process.env.CI;
			else process.env.CI = originalCI;
		}
		// CI auto-enable means we get per-phase JSON
		expect(lines.length).toBeGreaterThan(0);
		const events = lines.map((l) => JSON.parse(l) as PhaseEvent);
		expect(events.at(-1)?.phase).toBe("done");
		// `mode` reflects the setup mode (fresh/update/reset), not the runtime
		// channel. The runtime channel is reported via the boolean `ci` field.
		expect(events.at(-1)?.mode).toBe("fresh");
		expect(events.at(-1)?.ci).toBe(true);
	});

	test("user-agent is threaded into resolveSetupAI as maina-ci/<version>", async () => {
		makeGitRepo(tmpDir);
		let receivedUA: string | undefined;
		const deps = makeDeps({
			resolveAI: async (opts) => {
				receivedUA = opts.userAgent;
				return fakeAI("byok");
			},
		});
		await setupAction(
			{
				cwd: tmpDir,
				ci: true,
				emitter: jsonEmitter(() => {}),
			},
			deps,
		);
		expect(receivedUA).toBeDefined();
		expect(receivedUA?.startsWith("maina-ci/")).toBe(true);
	});

	test("non-ci interactive run sends maina/<version> user-agent", async () => {
		makeGitRepo(tmpDir);
		let receivedUA: string | undefined;
		const deps = makeDeps({
			resolveAI: async (opts) => {
				receivedUA = opts.userAgent;
				return fakeAI("byok");
			},
		});
		await setupAction({ cwd: tmpDir, yes: true }, deps);
		expect(receivedUA?.startsWith("maina/")).toBe(true);
		expect(receivedUA?.startsWith("maina-ci/")).toBe(false);
	});
});

// ── Sub-task 8: telemetry wiring ────────────────────────────────────────────

describe("setupAction — telemetry", () => {
	test("--no-telemetry (flag:false) skips call, telemetrySent='skipped'", async () => {
		// Clear env opt-out so the flag is the only opt-out signal under test.
		delete process.env.MAINA_TELEMETRY;
		makeGitRepo(tmpDir);
		let called = false;
		const deps = makeDeps();
		const result = await setupAction(
			{
				cwd: tmpDir,
				yes: true,
				telemetry: false,
				sendTelemetry: async () => {
					called = true;
					return { sent: true, error: null };
				},
			},
			deps,
		);
		expect(called).toBe(false);
		expect(result.telemetrySent).toBe("skipped");
	});

	test("MAINA_TELEMETRY=0 skips call, telemetrySent='skipped'", async () => {
		process.env.MAINA_TELEMETRY = "0";
		makeGitRepo(tmpDir);
		let called = false;
		const deps = makeDeps();
		const result = await setupAction(
			{
				cwd: tmpDir,
				yes: true,
				sendTelemetry: async () => {
					called = true;
					return { sent: true, error: null };
				},
			},
			deps,
		);
		expect(called).toBe(false);
		expect(result.telemetrySent).toBe("skipped");
	});

	test(".maina/config.json telemetry:false skips call", async () => {
		delete process.env.MAINA_TELEMETRY;
		makeGitRepo(tmpDir);
		mkdirSync(join(tmpDir, ".maina"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".maina", "config.json"),
			JSON.stringify({ telemetry: false }),
		);
		let called = false;
		const deps = makeDeps();
		const result = await setupAction(
			{
				cwd: tmpDir,
				yes: true,
				sendTelemetry: async () => {
					called = true;
					return { sent: true, error: null };
				},
			},
			deps,
		);
		expect(called).toBe(false);
		expect(result.telemetrySent).toBe("skipped");
	});

	test("opted in: POSTs anonymized event; telemetrySent=true on success", async () => {
		delete process.env.MAINA_TELEMETRY;
		makeGitRepo(tmpDir);
		let capturedEvent: unknown;
		const deps = makeDeps();
		const result = await setupAction(
			{
				cwd: tmpDir,
				yes: true,
				sendTelemetry: async (opts) => {
					capturedEvent = opts.event;
					return { sent: true, error: null };
				},
			},
			deps,
		);
		expect(result.telemetrySent).toBe(true);

		const event = capturedEvent as Record<string, unknown>;
		expect(event).toBeDefined();
		// Keys are exactly the documented payload — no cwd, no paths, no PII.
		const keys = Object.keys(event).sort();
		expect(keys).toEqual(
			[
				"aiSource",
				"ci",
				"degraded",
				"durationMs",
				"mainaVersion",
				"mode",
				"phases",
				"setupId",
				"stack",
				"tailored",
			].sort(),
		);
		expect(event.aiSource).toBe("byok");
		expect(event.tailored).toBe(true);
		expect(event.degraded).toBe(false);
		expect(event.mode).toBe("fresh");
		expect(Array.isArray(event.phases)).toBe(true);
		// Phases should include the pipeline milestones + final done.
		const phases = (event.phases as Array<{ phase: string }>).map(
			(p) => p.phase,
		);
		expect(phases).toContain("preflight");
		expect(phases).toContain("done");

		// Full serialised payload must not contain the cwd path, even as a
		// substring (double-check against accidental PII leakage).
		expect(JSON.stringify(event)).not.toContain(tmpDir);
	});

	test("telemetry failure never blocks setup (sender throws → telemetrySent=false)", async () => {
		delete process.env.MAINA_TELEMETRY;
		makeGitRepo(tmpDir);
		const deps = makeDeps();
		const result = await setupAction(
			{
				cwd: tmpDir,
				yes: true,
				sendTelemetry: async () => {
					throw new Error("simulated crash inside sender");
				},
			},
			deps,
		);
		// Setup still succeeds — bail flags are all clean.
		expect(result.bailed).toBe(false);
		expect(result.constitutionWritten).toBe(true);
		expect(result.telemetrySent).toBe(false);
	});

	test("bailed setup still attempts telemetry (opted-in)", async () => {
		delete process.env.MAINA_TELEMETRY;
		let called = false;
		const deps = makeDeps({ isGitRepo: () => false });
		const result = await setupAction(
			{
				cwd: tmpDir,
				yes: true,
				sendTelemetry: async () => {
					called = true;
					return { sent: true, error: null };
				},
			},
			deps,
		);
		expect(result.bailed).toBe(true);
		expect(called).toBe(true);
	});
});
