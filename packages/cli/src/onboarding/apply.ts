/**
 * Onboarding applier: carries out `planOnboarding` ops through ports.
 *
 * Each op re-reads its file at apply time, so a file that changed since
 * planning is still merged safely. The applier fails closed:
 * - `create` never replaces a file that exists by now;
 * - a merge that cannot be done safely (malformed JSON, a container of the
 *   wrong type) is skipped and the file left as it is;
 * - before the first merge into a user file, the original is copied to
 *   `.maina/backups/<path>`, and if that copy fails the file is not touched.
 * Per-file problems are reported in `skipped`; only an unsafe op path fails
 * the whole batch, before anything is written.
 */

import type { Result } from "@mainahq/core";
import { mergeJsonKey } from "./json-key";
import type { FileOp } from "./plan";
import {
	hasUnbalancedManagedMarkers,
	mergeManaged,
	wrapManaged,
} from "./setup/agent-files/region";

// ── Ports and results ────────────────────────────────────────────────────────

/** Filesystem rooted at the repository; paths are repo-relative. */
export interface OnboardingFs {
	/** Current contents, or `null` when the file does not exist. */
	readonly read: (path: string) => Result<string | null>;
	/** Atomic write that creates parent directories. */
	readonly write: (path: string, content: string) => Result<void>;
	/**
	 * Atomic no-clobber create that creates parent directories. Never
	 * replaces anything already at `path`; reports `"exists"` instead.
	 */
	readonly create: (
		path: string,
		content: string,
	) => Result<"created" | "exists">;
}

interface ApplyPorts {
	readonly fs: OnboardingFs;
}

interface SkippedOp {
	readonly path: string;
	readonly reason: string;
}

interface ApplyReport {
	readonly created: readonly string[];
	readonly merged: readonly string[];
	readonly unchanged: readonly string[];
	/** Backup copies written, as repo-relative paths. */
	readonly backups: readonly string[];
	readonly skipped: readonly SkippedOp[];
}

type ApplyError = { readonly kind: "unsafe-path"; readonly path: string };

export const BACKUP_DIR = ".maina/backups";

// ── Helpers ─────────────────────────────────────────────────────────────────

function isSafePath(path: string): boolean {
	if (path.length === 0 || path.startsWith("/") || path.includes("\\")) {
		return false;
	}
	if (/^[A-Za-z]:/.test(path)) return false;
	return path.split("/").every((seg) => seg !== ".." && seg !== "");
}

/** Read every path that exists; unreadable files are left out. */
export function snapshotFiles(
	fs: OnboardingFs,
	paths: readonly string[],
): ReadonlyMap<string, string> {
	const entries = paths.flatMap((path): [string, string][] => {
		const read = fs.read(path);
		return read.ok && read.value !== null ? [[path, read.value]] : [];
	});
	return new Map(entries);
}

type Outcome =
	| {
			readonly kind: "created" | "merged" | "unchanged";
			readonly backup?: string;
	  }
	| { readonly kind: "skipped"; readonly reason: string };

/** The bytes an op wants on disk, given the current bytes. */
function nextContent(
	op: FileOp,
	current: string | null,
):
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly reason: string } {
	switch (op.kind) {
		case "create":
			return current === null
				? { ok: true, text: op.content }
				: { ok: false, reason: "already exists; not overwritten" };
		case "merge-region":
			if (current !== null && hasUnbalancedManagedMarkers(current)) {
				return {
					ok: false,
					reason: "unbalanced maina-managed markers; left untouched",
				};
			}
			return {
				ok: true,
				text:
					current === null
						? `${wrapManaged(op.content)}\n`
						: mergeManaged(current, op.content),
			};
		case "merge-json-key": {
			let value: unknown;
			try {
				value = JSON.parse(op.content);
			} catch {
				return { ok: false, reason: "op content is not JSON" };
			}
			const merged = mergeJsonKey(current ?? "", op.keyPath, value);
			if (merged.kind === "invalid") {
				return { ok: false, reason: `${merged.reason}; left untouched` };
			}
			return {
				ok: true,
				text: merged.kind === "merged" ? merged.text : (current ?? ""),
			};
		}
		default: {
			const unreachable: never = op;
			return unreachable;
		}
	}
}

function backupOnce(
	fs: OnboardingFs,
	path: string,
	original: string,
): Result<string> {
	const target = `${BACKUP_DIR}/${path}`;
	const existing = fs.read(target);
	if (!existing.ok) return existing;
	if (existing.value !== null) return { ok: true, value: "" };
	// Backups hold copies of user files; keep them out of commits.
	fs.create(`${BACKUP_DIR}/.gitignore`, "*\n");
	const created = fs.create(target, original);
	if (!created.ok) return created;
	return { ok: true, value: created.value === "created" ? target : "" };
}

function applyOne(fs: OnboardingFs, op: FileOp): Outcome {
	const read = fs.read(op.path);
	if (!read.ok)
		return { kind: "skipped", reason: `read failed: ${read.error}` };
	const current = read.value;

	const next = nextContent(op, current);
	if (!next.ok) return { kind: "skipped", reason: next.reason };
	if (current !== null && next.text === current) return { kind: "unchanged" };

	let backup = "";
	if (op.backup && current !== null) {
		const copied = backupOnce(fs, op.path, current);
		if (!copied.ok) {
			return { kind: "skipped", reason: `backup failed: ${copied.error}` };
		}
		backup = copied.value;
	}

	if (current === null) {
		// No-clobber: a file that appeared since the read is left alone.
		const created = fs.create(op.path, next.text);
		if (!created.ok) {
			return { kind: "skipped", reason: `write failed: ${created.error}` };
		}
		return created.value === "created"
			? { kind: "created" }
			: { kind: "skipped", reason: "appeared during setup; not overwritten" };
	}
	const written = fs.write(op.path, next.text);
	if (!written.ok)
		return { kind: "skipped", reason: `write failed: ${written.error}` };
	return backup.length > 0 ? { kind: "merged", backup } : { kind: "merged" };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Apply planned ops in order. Returns an error, having written nothing,
 * when any op path is absolute or escapes the repository.
 */
export function applyOps(
	ops: readonly FileOp[],
	ports: ApplyPorts,
): Result<ApplyReport, ApplyError> {
	const unsafe = ops.find((op) => !isSafePath(op.path));
	if (unsafe !== undefined) {
		return { ok: false, error: { kind: "unsafe-path", path: unsafe.path } };
	}

	const created: string[] = [];
	const merged: string[] = [];
	const unchanged: string[] = [];
	const backups: string[] = [];
	const skipped: SkippedOp[] = [];

	for (const op of ops) {
		const outcome = applyOne(ports.fs, op);
		switch (outcome.kind) {
			case "created":
				created.push(op.path);
				break;
			case "merged":
				merged.push(op.path);
				break;
			case "unchanged":
				unchanged.push(op.path);
				break;
			case "skipped":
				skipped.push({ path: op.path, reason: outcome.reason });
				break;
			default: {
				const unreachable: never = outcome;
				return unreachable;
			}
		}
		if (outcome.kind !== "skipped" && outcome.backup !== undefined) {
			backups.push(outcome.backup);
		}
	}

	return { ok: true, value: { created, merged, unchanged, backups, skipped } };
}
