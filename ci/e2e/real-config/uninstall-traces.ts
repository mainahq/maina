/**
 * What a plugin's install → use → uninstall leaves behind, for the "leaves
 * no trace" cases of every host's plugin (#341, #342): a snapshot of the
 * workspace before and after, and the runtime the hooks started.
 */

import {
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	readlinkSync,
} from "node:fs";
import { join, relative } from "node:path";

/** Path (from the workspace root) → what is there. */
export type Snapshot = ReadonlyMap<string, string>;

/** Git's own state, which any git command may touch. */
const GIT_INTERNALS = /^project\/\.git\//;

export function snapshot(root: string): Snapshot {
	const out = new Map<string, string>();
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			const rel = relative(root, full);
			if (GIT_INTERNALS.test(rel)) continue;
			const stat = lstatSync(full);
			if (stat.isSymbolicLink()) out.set(rel, `link:${readlinkSync(full)}`);
			else if (stat.isDirectory()) {
				out.set(rel, "dir");
				walk(full);
			} else out.set(rel, `file:${Bun.hash(readFileSync(full))}`);
		}
	};
	walk(root);
	return out;
}

/**
 * The host's own plugin bookkeeping, which it keeps after the last
 * uninstall: directories it may create, and files that may change but must
 * no longer name maina (the caller checks their content).
 */
export interface Bookkeeping {
	readonly dirs: ReadonlySet<string>;
	readonly files: ReadonlySet<string>;
}

/** What install → use → uninstall left behind, as readable strings. */
export function traces(
	before: Snapshot,
	after: Snapshot,
	bookkeeping: Bookkeeping,
): readonly string[] {
	const found: string[] = [];
	for (const [path, what] of after) {
		const was = before.get(path);
		if (was === what) continue;
		if (was === undefined && bookkeeping.dirs.has(path)) continue;
		if (bookkeeping.files.has(path)) continue;
		found.push(`${was === undefined ? "added" : "changed"} ${path}`);
	}
	for (const path of before.keys()) {
		if (!after.has(path)) found.push(`removed ${path}`);
	}
	return found.sort();
}

/**
 * The socket a running runtime listens on, from its `--address` argument:
 * its runtime dir, or a private dir under tmp when that is too deep.
 */
export function runtimeAddress(pid: number): string | undefined {
	const ps = Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]);
	return /--address (\S+)/.exec(ps.stdout.toString())?.[1];
}

const readOrNull = (path: string): string | null => {
	try {
		return existsSync(path) ? readFileSync(path, "utf-8") : null;
	} catch {
		return null;
	}
};

/** The pid the runtime's pid file in `runDir` names. */
export function runtimePid(runDir: string): number | null {
	const pidFile = existsSync(runDir)
		? readdirSync(runDir).find((name) => name.endsWith(".pid"))
		: undefined;
	const raw = pidFile === undefined ? null : readOrNull(join(runDir, pidFile));
	if (raw === null) return null;
	const pid = (JSON.parse(raw) as { pid?: unknown }).pid;
	return typeof pid === "number" ? pid : null;
}

export function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function waitFor(
	check: () => boolean,
	ms: number,
): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (check()) return true;
		await Bun.sleep(100);
	}
	return check();
}
