/**
 * Carry out planned host `FileOp`s (./merge.ts, ./uninstall.ts) through a
 * filesystem port.
 *
 * Order per op: back up the original (never replacing an existing backup;
 * if the copy fails the file is not touched), write or delete the file,
 * then drop a backup the op retired. Writes are atomic (temp + rename) and
 * go *through* a symlinked config, so a dotfiles link stays a link.
 */

import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import type { Result } from "@mainahq/core";
import { createNoClobber } from "../onboarding/node-fs";
import type { FileOp, Snapshot } from "./merge";
import type { TargetFile } from "./targets";

// ── Port ────────────────────────────────────────────────────────────────────

/** Absolute-path filesystem for host config files. */
export interface HostFs {
	/** Contents, or `null` when the file does not exist. */
	readonly read: (path: string) => Result<string | null>;
	/**
	 * Atomic replace that keeps the file's permissions; creates parent
	 * directories; follows a symlink.
	 */
	readonly write: (path: string, content: string) => Result<void>;
	/**
	 * No-clobber create of an owner-only file (backups copy configs that
	 * may hold API keys); never replaces anything at `path`.
	 */
	readonly create: (
		path: string,
		content: string,
	) => Result<"created" | "exists">;
	/** Delete a regular file; a missing file is fine. */
	readonly remove: (path: string) => Result<void>;
}

/** The target's current bytes and backup. */
export function snapshotTarget(
	fs: HostFs,
	target: TargetFile,
): Result<Snapshot> {
	const text = fs.read(target.path);
	if (!text.ok) return text;
	const backup = fs.read(target.backupPath);
	if (!backup.ok) return backup;
	return { ok: true, value: { text: text.value, backup: backup.value } };
}

const BACKUP_ROOT = `${sep}.maina${sep}backups${sep}`;

/** `<…>/.maina/backups/.gitignore` for a backup under a repo or home. */
function backupGitignore(backupPath: string): string | null {
	const i = backupPath.lastIndexOf(BACKUP_ROOT);
	return i < 0
		? null
		: join(backupPath.slice(0, i + BACKUP_ROOT.length), ".gitignore");
}

/** Apply one op. Nothing is written when the backup cannot be made. */
export function applyFileOp(op: FileOp, fs: HostFs): Result<void> {
	if (op.content === undefined) return { ok: true, value: undefined };
	if (op.backup !== undefined) {
		const ignore = backupGitignore(op.backup.path);
		// Backups hold copies of user config; keep them out of commits.
		if (ignore !== null) fs.create(ignore, "*\n");
		const copied = fs.create(op.backup.path, op.backup.content);
		if (!copied.ok) {
			return { ok: false, error: `backup failed: ${copied.error}` };
		}
	}
	const written =
		op.content === null ? fs.remove(op.path) : fs.write(op.path, op.content);
	if (!written.ok) return written;
	if (op.dropBackup !== undefined) fs.remove(op.dropBackup);
	return { ok: true, value: undefined };
}

// ── Node adapter ────────────────────────────────────────────────────────────

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function tempPath(full: string): string {
	return `${full}.maina.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
}

export function nodeHostFs(): HostFs {
	return {
		read: (path) => {
			try {
				if (!existsSync(path)) return { ok: true, value: null };
				if (!statSync(path).isFile()) {
					return { ok: false, error: `${path} is not a regular file` };
				}
				return { ok: true, value: readFileSync(path, "utf-8") };
			} catch (e) {
				return { ok: false, error: message(e) };
			}
		},
		write: (path, content) => {
			let full = path;
			let mode: number | undefined;
			try {
				// Write through a symlink so the user's link survives, and keep
				// the file's mode: a 0600 config must not become world-readable.
				if (existsSync(path)) {
					full = realpathSync(path);
					mode = statSync(full).mode & 0o777;
				}
				mkdirSync(dirname(full), { recursive: true });
			} catch (e) {
				return { ok: false, error: message(e) };
			}
			const tmp = tempPath(full);
			try {
				// Owner-only until the final mode is set: never briefly wider.
				writeFileSync(tmp, content, { encoding: "utf-8", mode: 0o600 });
				if (mode !== undefined) chmodSync(tmp, mode);
				else chmodSync(tmp, 0o666 & ~process.umask());
				renameSync(tmp, full);
				return { ok: true, value: undefined };
			} catch (e) {
				try {
					rmSync(tmp, { force: true });
				} catch {
					// Best effort: the temp file may never have been created.
				}
				return { ok: false, error: message(e) };
			}
		},
		create: (path, content) => {
			try {
				return { ok: true, value: createNoClobber(path, content, 0o600) };
			} catch (e) {
				return { ok: false, error: message(e) };
			}
		},
		remove: (path) => {
			try {
				const st = lstatSync(path, { throwIfNoEntry: false });
				if (st === undefined) return { ok: true, value: undefined };
				if (!st.isFile()) {
					return { ok: false, error: `${path} is not a regular file` };
				}
				rmSync(path);
				return { ok: true, value: undefined };
			} catch (e) {
				return { ok: false, error: message(e) };
			}
		},
	};
}
