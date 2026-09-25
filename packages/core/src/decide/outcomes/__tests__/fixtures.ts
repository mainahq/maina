import { expect } from "bun:test";
import { migrateDecisionOutcomes } from "../../../db/decision-outcomes";
import type { Result } from "../../../db/index";
import type { DbPort } from "../../../ports/db";
import type { GitError, GitPort } from "../../../ports/git";
import { createFixedClock, createMemoryDb } from "../../../ports/testing";
import { appendDecision } from "../../log/append";
import { hashValue } from "../../log/hash";
import type { DecisionRecord } from "../../log/schema";
import type { DecisionType } from "../../types";
import type { OutcomePorts } from "../types";

export function unwrap<T, E>(
	result: { ok: true; value: T } | { ok: false; error: E },
): T {
	if (!result.ok) {
		expect(result.error).toBeUndefined();
		return undefined as never;
	}
	return result.value;
}

/** A memory database with the decision log and the outcome tables. */
export function outcomePorts(): OutcomePorts {
	const db = createMemoryDb();
	unwrap(migrateDecisionOutcomes(db));
	return { db, clock: createFixedClock(5_000) };
}

type LogOptions = Readonly<{
	id: string;
	type: DecisionType;
	finalAction?: string;
	ts?: number;
}>;

/** Appends a valid record of `type` to the log (bool or verdict question). */
export function logDecision(db: DbPort, options: LogOptions): DecisionRecord {
	const verdict = options.type === "action.risk";
	const optionOrder = verdict ? ["allow", "ask", "deny"] : [true, false];
	const record: DecisionRecord = {
		id: options.id,
		ts: options.ts ?? 1_000,
		type: options.type,
		inputHash: hashValue(`input:${options.id}`),
		schemaHash: hashValue(`schema:${options.type}`),
		optionOrder,
		policyHash: hashValue("policy"),
		modelHash: hashValue("model"),
		distribution: verdict
			? [
					{ answer: "allow", p: 0.2 },
					{ answer: "ask", p: 0.7 },
					{ answer: "deny", p: 0.1 },
				]
			: [
					{ answer: true, p: 0.8 },
					{ answer: false, p: 0.2 },
				],
		answer: verdict ? "ask" : true,
		finalAction: options.finalAction ?? "flag",
		latencyMs: 1,
	};
	return unwrap(appendDecision({ db }, record));
}

/** A deterministic 40-hex commit sha. */
export function sha(name: string): string {
	return hashValue(`commit:${name}`).slice("sha256:".length, 47);
}

export type FakeCommit = Readonly<{
	sha: string;
	subject: string;
	body?: string;
	/** `git show --format= --unified=0` output. */
	diff?: string;
}>;

/** One file's zero-context hunk, as `git show --unified=0` prints it. */
export function hunk(
	path: string,
	oldStart: number,
	oldCount: number,
	newStart: number,
	newCount: number,
): string {
	return [
		`diff --git a/${path} b/${path}`,
		"index 1111111..2222222 100644",
		`--- a/${path}`,
		`+++ b/${path}`,
		`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@ ctx`,
		...Array.from({ length: oldCount }, () => "-old"),
		...Array.from({ length: newCount }, () => "+new"),
		"",
	].join("\n");
}

type FakeRepo = GitPort & Readonly<{ calls: () => readonly string[] }>;

/**
 * A linear history, oldest commit first, answering the three git commands
 * the miner runs: the range log, the prior-commits log and `show`.
 */
export function fakeRepo(commits: readonly FakeCommit[]): FakeRepo {
	const calls: string[] = [];
	const failed = (args: readonly string[]): Result<never, GitError> => ({
		ok: false,
		error: {
			kind: "failed",
			exitCode: 128,
			stderr: `fake repo: cannot answer "${args.join(" ")}"`,
		},
	});
	const indexOf = (ref: string): number =>
		commits.findIndex((c) => c.sha === ref);
	return {
		calls: () => [...calls],
		run: async (_root, args) => {
			calls.push(args.join(" "));
			const [cmd, ...rest] = args;
			const target = rest[rest.length - 1] ?? "";
			if (cmd === "log" && rest[0] === "--reverse") {
				const since = target.replace(/\.\.HEAD$/, "");
				const at = indexOf(since);
				if (at < 0) return failed(args);
				const out = commits
					.slice(at + 1)
					.map((c) => `${c.sha}\x1f${c.subject}\x1f${c.body ?? ""}\x1e\n`)
					.join("");
				return { ok: true, value: out };
			}
			if (cmd === "log") {
				const at = indexOf(target);
				const max = Number(
					rest.find((a) => a.startsWith("--max-count="))?.split("=")[1],
				);
				if (at < 0 || !Number.isFinite(max)) return failed(args);
				const prior = commits
					.slice(Math.max(0, at - max), at)
					.reverse()
					.map((c) => `${c.sha}\n`)
					.join("");
				return { ok: true, value: prior };
			}
			if (cmd === "show") {
				const at = indexOf(target);
				if (at < 0) return failed(args);
				return { ok: true, value: commits[at]?.diff ?? "" };
			}
			return failed(args);
		},
	};
}
