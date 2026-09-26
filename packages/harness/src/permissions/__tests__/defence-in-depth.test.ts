/**
 * Defence in depth (FR-HAR-2 with FR-SBX-1): an action the agent approved
 * internally never reaches the gate (Codex in `agent-full-access` stops
 * asking; Claude Code in bypass mode skips `canUseTool`), so the sandbox
 * the worker runs in must still catch it, including an attempt to unhook
 * the Claude `PreToolUse` hook or loosen the policy snapshot it reads.
 *
 * The sandbox half needs the pinned sandbox runtime; without it the test is
 * skipped and says why (`MAINA_REQUIRE_SANDBOX=1` turns that into a failure).
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_POLICY } from "@mainahq/core";
import {
	integrationTitle,
	type Layout,
	makeLayout,
	run,
	SKIP_REASON,
	shell,
} from "../../sandbox/__tests__/sandbox-fixture";
import { configureInnerSandbox } from "../../sandbox/nested";
import { policyToSandbox } from "../../sandbox/policy-to-sandbox";
import { createSandboxRuntime } from "../../sandbox/runtime-adapter";
import { resolveWorker } from "../../workers/registry";
import { installClaudePreToolUse } from "../claude-sdk-hook";

const probe = {
	which: (binary: string) => `/usr/local/bin/${binary}`,
	version: () => null,
};

function guarded(layout: Layout, stateDir = join(layout.base, "state")) {
	const base = policyToSandbox(
		DEFAULT_POLICY,
		layout.worktree,
		layout.holdout,
		{
			home: layout.home,
			tmpDir: layout.tmp,
		},
	);
	if (!base.ok) throw new Error(base.error.message);
	const claude = resolveWorker("claude", probe);
	if (!claude.ok) throw new Error(claude.error.message);
	const installed = installClaudePreToolUse(claude.value, {
		worktree: layout.worktree,
		stateDir,
		policy: DEFAULT_POLICY,
		sandbox: base.value,
	});
	if (!installed.ok) throw new Error(installed.error.message);
	return installed.value;
}

describe("an internally auto-approved action", () => {
	test("never reaches the gate: Codex with its own sandbox off stops asking", () => {
		const codex = resolveWorker("codex", probe);
		if (!codex.ok) throw new Error(codex.error.message);
		const { worker } = configureInnerSandbox(codex.value, {
			platform: "darwin",
		});
		// Nothing asks before acting: only the outer sandbox can stop it.
		expect(worker.enforcement).toBe("sandbox-only");
		expect(worker.capabilities.permissionRequests).toBe(false);
	});

	test("the guarded sandbox denies writes to the hook settings and the policy snapshot", () => {
		const layout = makeLayout();
		const { sandbox, policyPath, settingsPath } = guarded(layout);
		expect(sandbox.writeDeny).toContain(join(layout.worktree, ".claude"));
		expect(sandbox.writeDeny).toContain(policyPath);
		expect(settingsPath.startsWith(join(layout.worktree, ".claude"))).toBe(
			true,
		);
	});
});

describe.skipIf(SKIP_REASON !== undefined)(
	integrationTitle(
		"an internally auto-approved action is caught by the sandbox",
	),
	() => {
		test("unhooking, loosening the policy and reading ~/.ssh all fail; worktree writes succeed", async () => {
			const layout = makeLayout();
			const installed = guarded(layout);
			const settingsBefore = readFileSync(installed.settingsPath, "utf8");
			const policyBefore = readFileSync(installed.policyPath, "utf8");
			const made = join(layout.worktree, "made.txt");
			// What an agent in bypass / full-access mode runs without asking.
			const script = [
				`echo '{}' > '${installed.settingsPath}'`,
				`rm -rf '${join(layout.worktree, ".claude")}'`,
				`echo '{}' > '${installed.policyPath}'`,
				`cat '${join(layout.home, ".ssh", "id_rsa")}'`,
				`echo ok > '${made}'`,
			].join("; ");
			const wrapped = createSandboxRuntime().wrap(
				shell(script),
				installed.sandbox,
			);
			if (!wrapped.ok) throw new Error(wrapped.error.message);
			const ran = await run(wrapped.value, layout.worktree);

			expect(readFileSync(installed.settingsPath, "utf8")).toBe(settingsBefore);
			expect(readFileSync(installed.policyPath, "utf8")).toBe(policyBefore);
			expect(ran.stdout).not.toContain("PRIVATE-KEY-316");
			expect(existsSync(made)).toBe(true);
		}, 30_000);

		test("the hook can read its policy snapshot in the sandbox, even under a read-denied root", async () => {
			const layout = makeLayout();
			// The worktrees root is read-denied (other runs' worktrees).
			const installed = guarded(
				layout,
				join(layout.worktreesRoot, ".maina-state"),
			);
			const policyBefore = readFileSync(installed.policyPath, "utf8");
			const wrapped = createSandboxRuntime().wrap(
				shell(
					`cat '${installed.policyPath}'; echo '{}' > '${installed.policyPath}'`,
				),
				installed.sandbox,
			);
			if (!wrapped.ok) throw new Error(wrapped.error.message);
			const ran = await run(wrapped.value, layout.worktree);

			expect(ran.stdout).toContain('"action_classes"');
			expect(readFileSync(installed.policyPath, "utf8")).toBe(policyBefore);
		}, 30_000);
	},
);
