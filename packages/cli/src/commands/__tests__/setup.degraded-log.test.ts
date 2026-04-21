/**
 * W3: degraded honesty — reason + recovery reach the terminal AND `.maina/setup.log`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	SetupAIResult,
	SetupDegradedReason,
	StackContext,
} from "@mainahq/core";
import { type SetupActionDeps, setupAction } from "../setup";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-setup-degraded-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	mkdirSync(join(dir, ".git"), { recursive: true });
	return dir;
}

function fakeStack(): StackContext {
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
	};
}

function fakeDegraded(
	reason: SetupDegradedReason,
	retryAt?: string,
): SetupAIResult {
	return {
		source: "degraded",
		text: "# Stub constitution\n",
		metadata: {
			source: "degraded",
			attemptedSources: ["cloud", "byok", "degraded"],
			durationMs: 1,
			reason,
			retryAt,
		},
	};
}

interface CollectedLog {
	warn: string[];
	info: string[];
	error: string[];
}

function makeDepsWithCapture(ai: SetupAIResult): {
	deps: SetupActionDeps;
	collected: CollectedLog;
} {
	const collected: CollectedLog = { warn: [], info: [], error: [] };
	const deps: SetupActionDeps = {
		intro: () => {},
		outro: () => {},
		log: {
			info: (m: string) => collected.info.push(m),
			warning: (m: string) => collected.warn.push(m),
			error: (m: string) => collected.error.push(m),
			success: () => {},
			message: () => {},
			step: () => {},
		},
		spinner: () => ({ start: () => {}, stop: () => {} }),
		isGitRepo: () => true,
		gitInit: async () => true,
		isDirty: async () => false,
		resolveAI: async () => ai,
		assembleStack: async () => ({ ok: true, value: fakeStack() }),
		writeAgentFiles: async () => ({
			ok: true,
			value: { written: ["AGENTS.md"], warnings: [] },
		}),
		runVerify: async () => ({ findings: [], clean: true }),
		confirm: async () => true,
		seedWiki: async () => ({
			ran: true,
			skipped: null,
			pages: 0,
			backgrounded: false,
			error: null,
		}),
	};
	return { deps, collected };
}

let tmpDir: string;
let originalTelemetryEnv: string | undefined;
let originalCiEnv: string | undefined;

beforeEach(() => {
	tmpDir = makeTmpDir();
	originalTelemetryEnv = process.env.MAINA_TELEMETRY;
	process.env.MAINA_TELEMETRY = "0";
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

describe("setupAction — degraded honesty", () => {
	test("writes .maina/setup.log with reason and recovery", async () => {
		const { deps } = makeDepsWithCapture(fakeDegraded("no_key"));
		await setupAction({ cwd: tmpDir, yes: true }, deps);
		const logPath = join(tmpDir, ".maina", "setup.log");
		expect(existsSync(logPath)).toBe(true);
		const contents = readFileSync(logPath, "utf-8");
		expect(contents).toContain("reason=no_key");
		expect(contents).toMatch(/recovery=/);
	});

	test("logger surfaces recovery command line", async () => {
		const { deps, collected } = makeDepsWithCapture(
			fakeDegraded("rate_limited", "2026-04-22T00:00:00Z"),
		);
		await setupAction({ cwd: tmpDir, yes: true }, deps);
		const allMessages = [...collected.warn, ...collected.info];
		const joined = allMessages.join("\n");
		expect(joined.toLowerCase()).toContain("retry");
	});

	test("warning banner is tailored per reason, not hardcoded 'AI unavailable'", async () => {
		const { deps, collected } = makeDepsWithCapture(fakeDegraded("no_key"));
		await setupAction({ cwd: tmpDir, yes: true }, deps);
		const warn = collected.warn.join("\n");
		expect(warn.toLowerCase()).toContain("api key");
		// The previous hardcoded banner said "AI unavailable (no_key)" — must be gone.
		expect(warn).not.toContain("AI unavailable (no_key)");
	});

	test("non-degraded outcomes do not write setup.log", async () => {
		const byok: SetupAIResult = {
			source: "byok",
			text: "# Constitution\n",
			metadata: {
				source: "byok",
				attemptedSources: ["byok"],
				durationMs: 1,
			},
		};
		const { deps } = makeDepsWithCapture(byok);
		await setupAction({ cwd: tmpDir, yes: true }, deps);
		const logPath = join(tmpDir, ".maina", "setup.log");
		expect(existsSync(logPath)).toBe(false);
	});
});
