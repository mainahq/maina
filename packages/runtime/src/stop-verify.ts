/**
 * Verify on session stop (v1 task 6.4, FR-VER-7).
 *
 * The runtime remembers the files each agent session edited, from the
 * session's `action.post` file edits (the same events the graph hooks read),
 * and verifies them when the session's `session.stop` event arrives:
 *
 * - No edits since the last stop: nothing runs, and the stop answers
 *   `allow` with an empty reason, which every host adapter renders as `{}`.
 * - `failed`: the stop answers `deny` with the reason to fix it, which the
 *   adapters render as their stop contract's block (Claude Code and Codex
 *   `decision: "block"`, Cursor `followup_message`). The files stay
 *   remembered, so the next stop checks them again, but only once the agent
 *   edits something: a stop with no new edits runs nothing and is let
 *   through, so a block can never loop, with a summary that verify is still
 *   failing (never silently).
 * - `passed` or `skipped`: `allow` with a one-line summary; the session's
 *   files are forgotten.
 * - A verify that cannot run never holds up the stop: `allow`, saying why.
 *
 * Events are keyed by `input.sessionId`; an edit without one is not tracked.
 * Paths are made absolute against the event's directory when edited and
 * relative to the stop's repository root when verified.
 */

import { isAbsolute, relative, sep } from "node:path";
import type { VerifyStatus } from "@mainahq/core";
import type { GateDecision, GateEvent } from "./gate";
import { graphTrigger } from "./graph-hooks";

/** The event kind that ends a session (spec §6.2). */
export const SESSION_STOP = "session.stop";

/** What one verify run on a session's files found. */
export type StopVerifyReport = Readonly<{
	status: VerifyStatus;
	/** Findings shown on the changed lines. */
	findings: number;
	/** Files verify checked. */
	files: number;
}>;

export type StopVerifyPorts = Readonly<{
	/** The repository root containing `dir`, or null outside one. */
	rootOf: (dir: string) => Promise<string | null>;
	/**
	 * Verifies `files` (relative to `root`). Null when verify does not apply
	 * to the repository (maina was never set up in it).
	 */
	verify: (
		root: string,
		files: readonly string[],
	) => Promise<StopVerifyReport | null>;
	/**
	 * The canonical spelling of an absolute path, so a host's path compares
	 * with git's root (which has symlinks resolved). Identity by default.
	 */
	canonical?: (path: string) => string;
}>;

type StopVerify = Readonly<{
	/** Records the files an event says its session edited. Synchronous. */
	observe: (event: GateEvent) => null;
	/** Answers a `session.stop` event; never rejects. */
	stop: (event: GateEvent) => Promise<GateDecision>;
}>;

type SessionEdits = {
	/** Absolute paths edited and not yet verified clean. */
	files: Set<string>;
	/** Edited since the last stop ran verify. */
	dirty: boolean;
	/** Directory of the latest edit, for a stop that names none. */
	dir: string;
	/** The failed report that last blocked the stop, until a verify clears it. */
	blocked: StopVerifyReport | null;
};

/** Sessions remembered at once; the oldest is dropped past this. */
const MAX_SESSIONS = 1024;

/** A stop with nothing to say: every host renders it as `{}`. */
export const QUIET_STOP: GateDecision = { verdict: "allow", reason: "" };

const nonEmpty = (value: unknown): value is string =>
	typeof value === "string" && value !== "";

const plural = (n: number, word: string): string =>
	`${n} ${word}${n === 1 ? "" : "s"}`;

const errorMessage = (err: unknown): string =>
	err instanceof Error ? err.message : String(err);

/** What a failed report found, as " (…)". Pure. */
function failedCount(report: StopVerifyReport): string {
	const changed = plural(report.files, "changed file");
	// A syntax error fails verify with no finding to count.
	return report.findings === 0
		? ` (${changed})`
		: ` (${plural(report.findings, "finding")} in ${changed})`;
}

/**
 * A stop after a block with no new edits: let through, so a block never
 * loops, but never silently. Pure.
 */
function stillFailing(report: StopVerifyReport): GateDecision {
	return {
		verdict: "allow",
		reason: `maina verify: still failing on changed lines${failedCount(report)}; not re-run, nothing was edited since the block.`,
	};
}

/** The stop decision for a verify report. Pure. */
function stopDecision(report: StopVerifyReport): GateDecision {
	const changed = plural(report.files, "changed file");
	switch (report.status) {
		case "failed":
			return {
				verdict: "deny",
				reason: `maina verify failed on changed lines${failedCount(report)}; fix before finishing.`,
			};
		case "passed":
			return {
				verdict: "allow",
				reason:
					report.findings === 0
						? `maina verify: passed on ${changed}`
						: `maina verify: passed on ${changed}, ${plural(report.findings, "non-blocking finding")}`,
			};
		case "skipped":
			return {
				verdict: "allow",
				reason: `maina verify: skipped, no checker ran on ${changed}`,
			};
	}
}

export function createStopVerify(ports: StopVerifyPorts): StopVerify {
	const canonical = ports.canonical ?? ((path: string) => path);
	const sessions = new Map<string, SessionEdits>();

	const observe = (event: GateEvent): null => {
		const sessionId = event.input.sessionId;
		if (!nonEmpty(sessionId)) return null;
		const trigger = graphTrigger(event);
		if (trigger?.kind !== "edit") return null;
		const edits = sessions.get(sessionId) ?? {
			files: new Set<string>(),
			dirty: false,
			dir: trigger.dir,
			blocked: null,
		};
		// Re-insert so the map stays ordered oldest-touched first.
		sessions.delete(sessionId);
		sessions.set(sessionId, edits);
		for (const path of trigger.paths) edits.files.add(path);
		edits.dirty = true;
		edits.dir = trigger.dir;
		if (sessions.size > MAX_SESSIONS) {
			const oldest = sessions.keys().next().value;
			if (oldest !== undefined) sessions.delete(oldest);
		}
		return null;
	};

	/** The session's files under `root`, relative to it and sorted. */
	const filesUnder = (root: string, files: Iterable<string>): string[] => {
		const base = canonical(root);
		return [...files]
			.map((file) => relative(base, canonical(file)))
			.filter(
				(rel) => rel !== "" && rel.split(sep)[0] !== ".." && !isAbsolute(rel),
			)
			.sort();
	};

	const verifySession = async (
		sessionId: string,
		edits: SessionEdits,
		dir: string,
	): Promise<GateDecision> => {
		edits.dirty = false;
		// Edits that arrived while the ports ran are checked at the next stop;
		// an entry evicted and recreated meanwhile is not this one to drop.
		const forget = () => {
			if (!edits.dirty && sessions.get(sessionId) === edits) {
				sessions.delete(sessionId);
			}
		};
		const root = await ports.rootOf(dir);
		const files = root === null ? [] : filesUnder(root, edits.files);
		if (root === null || files.length === 0) {
			forget();
			return QUIET_STOP;
		}
		const report = await ports.verify(root, files);
		if (report === null) {
			forget();
			return QUIET_STOP;
		}
		if (report.status === "failed") edits.blocked = report;
		else {
			edits.blocked = null;
			forget();
		}
		return stopDecision(report);
	};

	const stop = async (event: GateEvent): Promise<GateDecision> => {
		const sessionId = event.input.sessionId;
		if (!nonEmpty(sessionId)) return QUIET_STOP;
		const edits = sessions.get(sessionId);
		if (edits === undefined) return QUIET_STOP;
		if (!edits.dirty) {
			return edits.blocked === null ? QUIET_STOP : stillFailing(edits.blocked);
		}
		const root = event.input.root;
		const dir = nonEmpty(root) ? root : (event.cwd ?? edits.dir);
		try {
			return await verifySession(sessionId, edits, dir);
		} catch (err) {
			edits.blocked = null;
			return {
				verdict: "allow",
				reason: `maina verify could not run on this session's changes (${errorMessage(err)})`,
			};
		}
	};

	return { observe, stop };
}
