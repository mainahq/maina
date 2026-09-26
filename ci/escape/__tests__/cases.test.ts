/**
 * The escape and bypass suite's cases, checked for shape and coverage
 * (v1 task 4B.9, FR-SBX-5). These are the failing-first expectations: the
 * suite must carry at least 60 distinct escape attempts spanning every
 * category the sandbox is meant to hold — path traversal and symlink
 * writes, `$HOME` credential reads, DNS and IP network bypass, env and
 * credential exfiltration, prompt injection that disables the sandbox or
 * hooks, bypass-permission modes and holdout reads.
 *
 * This file runs everywhere (no sandbox runtime needed); the escapes
 * themselves are exercised by `escape-suite.test.ts` under a real `srt`.
 */

import { describe, expect, test } from "bun:test";
import {
	ESCAPE_CASES,
	ESCAPE_CATEGORIES,
	type EscapeCase,
	type EscapeContext,
} from "../cases";

const fakeContext = (): EscapeContext => ({
	layout: {
		base: "/tmp/base",
		home: "/tmp/base/home",
		worktreesRoot: "/tmp/base/worktrees",
		worktree: "/tmp/base/worktrees/run-1",
		otherWorktree: "/tmp/base/worktrees/run-2",
		holdout: "/tmp/base/holdout",
		outside: "/tmp/base/outside",
		tmp: "/tmp/base/tmp",
	},
	settingsPath: "/tmp/base/worktrees/run-1/.claude/settings.local.json",
	policyPath: "/tmp/base/state/claude-hook-policy.json",
	logPath: "/tmp/base/state/claude-hook-log.jsonl",
	server: { host: "127.0.0.1", port: 59999, marker: "SERVER-MARKER-322" },
	allowedHost: "allowed.example.test",
	secretEnvName: "GITHUB_TOKEN",
	secretEnvValue: "ghp_ambient_322",
	maskedCredName: "ANTHROPIC_API_KEY",
	maskedCredValue: "sk-ant-real-322",
	settingsBefore: '{"hooks":{}}',
	policyBefore: '{"action_classes":{}}',
	homeSecretMarker: "PRIVATE-KEY-322",
	otherWorktreeMarker: "OTHER-RUN-322",
	holdoutMarker: "HOLDOUT-322",
});

describe("the escape suite", () => {
	test("carries at least 60 cases", () => {
		expect(ESCAPE_CASES.length).toBeGreaterThanOrEqual(60);
	});

	test("every category the issue names is exercised", () => {
		const seen = new Set(ESCAPE_CASES.map((c) => c.category));
		for (const category of ESCAPE_CATEGORIES) {
			expect(seen.has(category)).toBe(true);
		}
	});

	test("no category is left with a token single case", () => {
		for (const category of ESCAPE_CATEGORIES) {
			const count = ESCAPE_CASES.filter((c) => c.category === category).length;
			expect(count).toBeGreaterThanOrEqual(4);
		}
	});

	test("case ids are unique and slug-shaped", () => {
		const ids = ESCAPE_CASES.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		}
	});

	test("every case builds a non-empty attack script from a context", () => {
		const ctx = fakeContext();
		for (const c of ESCAPE_CASES) {
			const script = c.script(ctx);
			expect(typeof script).toBe("string");
			expect(script.length).toBeGreaterThan(0);
		}
	});

	test("every category is a declared one", () => {
		const declared = new Set<EscapeCase["category"]>(ESCAPE_CATEGORIES);
		for (const c of ESCAPE_CASES) {
			expect(declared.has(c.category)).toBe(true);
		}
	});
});
