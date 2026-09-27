/**
 * Every worker's gate integration (FR-HAR-2, FR-SBX-5): what the harness
 * installs in a run's worktree so the gate keeps seeing that agent's calls,
 * and the sandbox options that stop the agent undoing it. Claude Code gets
 * its `PreToolUse` hook; an ACP worker gets its own permission config
 * pinned to asking, so every gated call reaches `session/request_permission`.
 */

import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxOptions } from "../../sandbox/port";
import { resolveWorker, WORKER_NAMES } from "../../workers/registry";
import type { WorkerSpec } from "../../workers/spec";
import {
	GATE_CONFIGS,
	installWorkerGate,
	pinGateConfig,
	uninstallWorkerGate,
} from "../worker-gate";
import { DENY_PUBLISH } from "./gate-fixture";

const probe = {
	which: (binary: string) => `/usr/local/bin/${binary}`,
	version: () => null,
};

function worker(name: string): WorkerSpec {
	const resolved = resolveWorker(name, probe);
	if (!resolved.ok) throw new Error(resolved.error.message);
	return resolved.value;
}

function setup(): {
	worktree: string;
	stateDir: string;
	sandbox: SandboxOptions;
} {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "maina-gate-")));
	const worktree = join(base, "worktrees", "run-1");
	const stateDir = join(base, "state");
	mkdirSync(worktree, { recursive: true });
	return {
		worktree,
		stateDir,
		sandbox: {
			writeAllow: [worktree],
			writeDeny: [join(base, "holdout")],
			readDeny: [],
			netAllow: [],
			credentials: [],
		},
	};
}

const ACP_WORKERS = WORKER_NAMES.filter((name) => name !== "claude");

describe("GATE_CONFIGS", () => {
	test("every ACP worker the registry knows has a gate config", () => {
		expect(Object.keys(GATE_CONFIGS).sort()).toEqual([...ACP_WORKERS].sort());
	});

	test("each lives in a directory of its own inside the worktree", () => {
		for (const name of ACP_WORKERS) {
			const { dir, file } = GATE_CONFIGS[name];
			expect(dir.startsWith(".")).toBe(true);
			expect(dir.includes("/")).toBe(false);
			expect(file.length).toBeGreaterThan(0);
		}
	});
});

describe("pinGateConfig", () => {
	test("from nothing, each worker is told to ask", () => {
		const pinned = (name: (typeof ACP_WORKERS)[number]) => {
			const r = pinGateConfig(name, undefined);
			if (!r.ok) throw new Error(r.error.message);
			return r.value;
		};
		expect(pinned("codex")).toContain('approval_policy = "untrusted"');
		expect(JSON.parse(pinned("cursor"))).toEqual({
			permissions: { allow: [], deny: [] },
		});
		expect(JSON.parse(pinned("gemini"))).toEqual({
			tools: { autoAccept: false },
			security: { disableYoloMode: true },
		});
		expect(JSON.parse(pinned("opencode"))).toEqual({
			permission: { edit: "ask", bash: "ask", webfetch: "ask" },
		});
	});

	test("a repo's own JSON settings are kept, only the approvals are pinned", () => {
		const r = pinGateConfig(
			"gemini",
			JSON.stringify({
				mcpServers: { docs: { command: "docs-mcp" } },
				tools: { autoAccept: true, exclude: ["web_fetch"] },
			}),
		);
		if (!r.ok) throw new Error(r.error.message);
		expect(JSON.parse(r.value)).toEqual({
			mcpServers: { docs: { command: "docs-mcp" } },
			tools: { autoAccept: false, exclude: ["web_fetch"] },
			security: { disableYoloMode: true },
		});
	});

	test("a Cursor allow list, which would skip the ask, is emptied; its denies stay", () => {
		const r = pinGateConfig(
			"cursor",
			JSON.stringify({
				permissions: { allow: ["Shell(*)"], deny: ["Write(.env)"] },
			}),
		);
		if (!r.ok) throw new Error(r.error.message);
		expect(JSON.parse(r.value)).toEqual({
			permissions: { allow: [], deny: ["Write(.env)"] },
		});
	});

	test("a Codex config keeps its tables; a top-level approval or profile is replaced", () => {
		const r = pinGateConfig(
			"codex",
			[
				'approval_policy = "never"',
				'profile = "yolo"',
				'model = "o4"',
				"",
				"[profiles.yolo]",
				'approval_policy = "never"',
				"",
			].join("\n"),
		);
		if (!r.ok) throw new Error(r.error.message);
		const lines = r.value.split("\n");
		expect(lines[0]).toBe('approval_policy = "untrusted"');
		expect(lines).toContain('model = "o4"');
		expect(lines).toContain("[profiles.yolo]");
		expect(lines).not.toContain('profile = "yolo"');
		// Only the pinned one is left at the top level.
		const topLevel = lines.slice(0, lines.indexOf("[profiles.yolo]"));
		expect(topLevel.filter((l) => l.startsWith("approval_policy"))).toEqual([
			'approval_policy = "untrusted"',
		]);
	});

	test("unreadable JSON is an error, never overwritten", () => {
		const r = pinGateConfig("opencode", "{nope");
		expect(r.ok).toBe(false);
	});
});

describe("installWorkerGate", () => {
	test("Claude Code gets its PreToolUse hook, guarded the same way", () => {
		const { worktree, stateDir, sandbox } = setup();
		const installed = installWorkerGate(worker("claude"), {
			worktree,
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		if (!installed.ok) throw new Error(installed.error.message);
		const { configDir, configPath, policyPath } = installed.value;
		expect(configDir).toBe(join(worktree, ".claude"));
		expect(configPath).toBe(join(worktree, ".claude", "settings.local.json"));
		expect(readFileSync(configPath, "utf8")).toContain("PreToolUse");
		expect(installed.value.sandbox.writeDeny).toContain(configDir);
		expect(installed.value.sandbox.writeDeny).toContain(policyPath);
	});

	for (const name of ACP_WORKERS) {
		test(`${name}: its permission config is pinned in the worktree and guarded`, () => {
			const { worktree, stateDir, sandbox } = setup();
			const installed = installWorkerGate(worker(name), {
				worktree,
				stateDir,
				policy: DENY_PUBLISH,
				sandbox,
			});
			if (!installed.ok) throw new Error(installed.error.message);
			const { configDir, configPath, policyPath, logPath } = installed.value;
			const { dir, file } = GATE_CONFIGS[name];
			expect(configDir).toBe(join(worktree, dir));
			expect(configPath).toBe(join(worktree, dir, file));
			const pinned = pinGateConfig(name, undefined);
			if (!pinned.ok) throw new Error(pinned.error.message);
			expect(readFileSync(configPath, "utf8")).toBe(pinned.value);
			// The run's policy is recorded outside the worktree, beside the log.
			expect(policyPath.startsWith(stateDir)).toBe(true);
			expect(JSON.parse(readFileSync(policyPath, "utf8"))).toEqual(
				JSON.parse(JSON.stringify(DENY_PUBLISH)),
			);
			// The bridge answers from outside the sandbox: the agent writes
			// none of the gate's files, the log included.
			expect(installed.value.sandbox.writeDeny).toEqual([
				...(sandbox.writeDeny ?? []),
				configDir,
				policyPath,
				logPath,
			]);
			expect(installed.value.sandbox.writeAllow).toEqual(sandbox.writeAllow);
		});
	}

	test("a headless fallback has no gate to install: nothing asks", () => {
		const { worktree, stateDir, sandbox } = setup();
		const installed = installWorkerGate(worker("headless:gemini"), {
			worktree,
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		expect(installed.ok).toBe(false);
		if (!installed.ok) expect(installed.error.code).toBe("unsupported_worker");
	});

	test("relative paths are refused", () => {
		const { stateDir, sandbox } = setup();
		const installed = installWorkerGate(worker("opencode"), {
			worktree: "worktrees/run-1",
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		expect(installed.ok).toBe(false);
		if (!installed.ok) expect(installed.error.code).toBe("invalid_options");
	});

	test("a repo's config is backed up before the first write; uninstall restores it byte for byte", () => {
		const { worktree, stateDir, sandbox } = setup();
		const configPath = join(worktree, ".gemini", "settings.json");
		mkdirSync(join(worktree, ".gemini"));
		const original = '{ "tools": { "autoAccept": true } }\n';
		writeFileSync(configPath, original);
		const options = { worktree, stateDir, policy: DENY_PUBLISH, sandbox };
		for (let i = 0; i < 2; i++) {
			const installed = installWorkerGate(worker("gemini"), options);
			if (!installed.ok) throw new Error(installed.error.message);
		}
		expect(JSON.parse(readFileSync(configPath, "utf8")).tools.autoAccept).toBe(
			false,
		);
		expect(uninstallWorkerGate(worker("gemini"), worktree).ok).toBe(true);
		expect(readFileSync(configPath, "utf8")).toBe(original);
		expect(existsSync(`${configPath}.maina-backup`)).toBe(false);
	});

	test("uninstall deletes a config maina created, and is a no-op when nothing was installed", () => {
		const { worktree, stateDir, sandbox } = setup();
		expect(uninstallWorkerGate(worker("cursor"), worktree).ok).toBe(true);
		const installed = installWorkerGate(worker("cursor"), {
			worktree,
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		if (!installed.ok) throw new Error(installed.error.message);
		expect(uninstallWorkerGate(worker("cursor"), worktree).ok).toBe(true);
		expect(existsSync(installed.value.configPath)).toBe(false);
	});

	test("unreadable repo config is an error, never overwritten", () => {
		const { worktree, stateDir, sandbox } = setup();
		mkdirSync(join(worktree, ".opencode"));
		const configPath = join(worktree, ".opencode", "opencode.json");
		writeFileSync(configPath, "{nope");
		const installed = installWorkerGate(worker("opencode"), {
			worktree,
			stateDir,
			policy: DENY_PUBLISH,
			sandbox,
		});
		expect(installed.ok).toBe(false);
		if (!installed.ok) expect(installed.error.code).toBe("invalid_settings");
		expect(readFileSync(configPath, "utf8")).toBe("{nope");
	});
});
