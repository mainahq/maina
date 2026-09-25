/**
 * Node filesystem adapter for the onboarding `OnboardingFs` port.
 *
 * Rooted at the repository: every path is repo-relative. Writes go to a
 * unique temp file that is renamed into place, so an interrupted run never
 * leaves a half-written file behind.
 */

import {
	existsSync,
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
			const tmp = `${full}.maina.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
			try {
				mkdirSync(dirname(full), { recursive: true });
				writeFileSync(tmp, content, "utf-8");
				renameSync(tmp, full);
				return { ok: true, value: undefined };
			} catch (e) {
				try {
					rmSync(tmp, { force: true });
				} catch {
					// The temp file was never created (e.g. parent is a file).
				}
				return { ok: false, error: message(e) };
			}
		},
	};
}
