/**
 * What every evidence producer shares (v1 task 12.1, #558): the link to the
 * run the evidence came from, argument parsing and the file I/O at the edge.
 * The producers' logic is pure and lives beside this; only this file and
 * each producer's `import.meta.main` block touch the filesystem.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type Result<T, E> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: E }>;

type Env = Readonly<Record<string, string | undefined>>;

/** The Actions run URL, or a note that there is none outside CI. */
export function runLink(env: Env): string {
	const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
	return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
		? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
		: "local run (no CI link)";
}

/** The value after `name` in `argv`, if any. */
export function flag(
	argv: readonly string[],
	name: string,
): string | undefined {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
}

/** A file's text, or `undefined` when it does not exist. */
export function readText(path: string | undefined): string | undefined {
	return path !== undefined && existsSync(path)
		? readFileSync(path, "utf-8")
		: undefined;
}

/** A file's parsed JSON, or `undefined` when it is missing or not JSON. */
export function readJson(path: string | undefined): unknown {
	const text = readText(path);
	if (text === undefined) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** Every file under `dir` whose name ends in `suffix`, sorted. */
export function filesUnder(dir: string, suffix: string): readonly string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	const walk = (d: string): void => {
		for (const name of readdirSync(d)) {
			const full = join(d, name);
			if (statSync(full).isDirectory()) walk(full);
			else if (name.endsWith(suffix)) out.push(full);
		}
	};
	walk(dir);
	return out.sort();
}

/**
 * Writes `evidence` as JSON to `out`, or reports why there is none and
 * sets a failing exit code: a missing file makes the gate say MISSING,
 * never a made-up value.
 */
export function emit(
	label: string,
	out: string | undefined,
	evidence: Result<unknown, string>,
): void {
	if (out === undefined) {
		process.stderr.write(`${label}: --out <file> is required\n`);
		process.exitCode = 2;
		return;
	}
	if (!evidence.ok) {
		process.stderr.write(`${label}: no evidence: ${evidence.error}\n`);
		process.exitCode = 1;
		return;
	}
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, `${JSON.stringify(evidence.value, null, "\t")}\n`);
	process.stdout.write(`${label}: wrote ${out}\n`);
}
