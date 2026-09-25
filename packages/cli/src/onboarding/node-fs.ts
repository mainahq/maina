/**
 * Node filesystem adapter for the onboarding `OnboardingFs` port.
 *
 * Rooted at the repository: every path is repo-relative. Writes go to a
 * unique temp file that is renamed into place, so an interrupted run never
 * leaves a half-written file behind.
 *
 * A symlinked target (for example `CLAUDE.md -> AGENTS.md`) is never
 * written: renaming over it would replace the user's link with a regular
 * file, and writing through it would let two targets fight over one file.
 * The write fails, so `applyOps` reports the file as skipped.
 */

import {
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { OnboardingFs } from "./apply";

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function errorCode(e: unknown): string | undefined {
	return typeof e === "object" && e !== null && "code" in e
		? String((e as { code: unknown }).code)
		: undefined;
}

function tempPath(full: string): string {
	return `${full}.maina.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
}

function removeQuietly(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {
		// The temp file was never created (e.g. parent is a file).
	}
}

/**
 * Publish `content` at `full` only if nothing is there. `link(2)` is atomic
 * and fails with EEXIST when the name exists (a dangling symlink included),
 * so a file created by someone else after our read is never replaced.
 * Filesystems without hard links fall back to an exclusive `wx` open.
 */
function createNoClobber(full: string, content: string): "created" | "exists" {
	mkdirSync(dirname(full), { recursive: true });
	const tmp = tempPath(full);
	try {
		writeFileSync(tmp, content, "utf-8");
		try {
			linkSync(tmp, full);
			return "created";
		} catch (e) {
			const code = errorCode(e);
			if (code === "EEXIST") return "exists";
			if (code !== "EPERM" && code !== "ENOTSUP" && code !== "ENOSYS") {
				throw e;
			}
		}
		try {
			writeFileSync(full, content, { encoding: "utf-8", flag: "wx" });
			return "created";
		} catch (e) {
			if (errorCode(e) === "EEXIST") return "exists";
			throw e;
		}
	} finally {
		removeQuietly(tmp);
	}
}

export function nodeOnboardingFs(root: string): OnboardingFs {
	return {
		read: (path) => {
			const full = join(root, path);
			try {
				if (!existsSync(full)) return { ok: true, value: null };
				if (!statSync(full).isFile()) {
					return { ok: false, error: "not a regular file" };
				}
				return { ok: true, value: readFileSync(full, "utf-8") };
			} catch (e) {
				return { ok: false, error: message(e) };
			}
		},
		write: (path, content) => {
			const full = join(root, path);
			const tmp = tempPath(full);
			try {
				if (lstatSync(full, { throwIfNoEntry: false })?.isSymbolicLink()) {
					return { ok: false, error: "is a symbolic link; not replaced" };
				}
			} catch (e) {
				return { ok: false, error: message(e) };
			}
			try {
				mkdirSync(dirname(full), { recursive: true });
				writeFileSync(tmp, content, "utf-8");
				renameSync(tmp, full);
				return { ok: true, value: undefined };
			} catch (e) {
				removeQuietly(tmp);
				return { ok: false, error: message(e) };
			}
		},
		create: (path, content) => {
			try {
				return { ok: true, value: createNoClobber(join(root, path), content) };
			} catch (e) {
				return { ok: false, error: message(e) };
			}
		},
	};
}
