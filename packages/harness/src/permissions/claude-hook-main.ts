/**
 * The Claude Code `PreToolUse` hook process that `installClaudePreToolUse`
 * registers (FR-HAR-2): the hook's only I/O edge.
 *
 * Usage: bun claude-hook-main.ts <worktree> <policy.json> <log.jsonl>
 *
 * Reads the hook payload on stdin, judges it with core's gate against the
 * run's policy snapshot (rules only: a hook has no model backend), appends
 * one record to the log and answers Claude Code. Anything that goes wrong
 * denies: an unreadable snapshot, a crash. Claude Code runs a tool when its
 * hook exits with anything but 2, so this process never exits otherwise
 * on a failure.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
	DEFAULT_REGISTRY,
	loadShellParser,
	type Policy,
	withBackend,
} from "@mainahq/core";
import {
	answerClaudePreToolUse,
	type ClaudeHookOutput,
} from "./claude-sdk-hook";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Enough of a policy's shape that the gate can read it. */
function isPolicy(value: unknown): value is Policy {
	return (
		isRecord(value) &&
		isRecord(value.action_classes) &&
		isRecord(value.decisions) &&
		isRecord(value.rules) &&
		Array.isArray(value.rules.allow) &&
		Array.isArray(value.rules.deny) &&
		Array.isArray(value.loosened)
	);
}

function denied(reason: string): ClaudeHookOutput {
	return {
		exitCode: 2,
		stdout: `${JSON.stringify({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: reason,
			},
		})}\n`,
		stderr: `${reason}\n`,
	};
}

const parse = (raw: string): unknown => {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
};

async function main(): Promise<ClaudeHookOutput> {
	const [root, policyPath, logPath] = process.argv.slice(2);
	if (root === undefined || policyPath === undefined || logPath === undefined) {
		return denied("maina hook: missing arguments; denied");
	}
	const payload = parse(await Bun.stdin.text());
	const policy = parse(readFileSync(policyPath, "utf8"));
	if (!isPolicy(policy)) {
		return denied(
			`maina hook: the policy snapshot ${policyPath} is unreadable; denied`,
		);
	}
	// Without the grammar every shell call is opaque, so it is denied.
	const shell = await loadShellParser();
	return answerClaudePreToolUse(
		{
			ports: {
				clock: { now: () => Date.now() },
				backends: DEFAULT_REGISTRY,
				ctx: { shell: shell.ok ? shell.value : null, home: homedir() },
				newId: randomUUID,
			},
			policy: withBackend(policy, "action.risk", "rules"),
			log: (record) => appendFileSync(logPath, `${JSON.stringify(record)}\n`),
		},
		root,
		payload,
	);
}

const out = await main().catch((e: unknown) =>
	denied(
		`maina hook failed (${e instanceof Error ? e.message : String(e)}); denied`,
	),
);
process.stdout.write(out.stdout);
process.stderr.write(out.stderr);
process.exitCode = out.exitCode;
