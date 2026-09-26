#!/usr/bin/env bun
/**
 * The docs-build evidence for spec §9.4 (v1 task 12.1, #558): the docs site
 * build (`packages/docs`, which renders the generated reference pages)
 * exited 0 and logged no `[WARN]` or `[ERROR]` line.
 *
 *   bun scripts/release/evidence/docs-build.ts --exit <code> --log <file> --out <file>
 */

export type DocsBuildEvidence = Readonly<{
	link: string;
	clean: boolean;
	exitCode: number;
	/** The first warning and error lines, quoted. */
	warnings: readonly string[];
}>;

const MAX_QUOTED = 20;
/** Astro and Vite tag their log lines; a page path is never tagged. */
const WARNING = /\[(warn|warning|error)\]/i;

export function docsBuildEvidence(
	exitCode: number,
	log: string,
	link: string,
): DocsBuildEvidence {
	const warnings = log
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => WARNING.test(l));
	return {
		link,
		clean: exitCode === 0 && warnings.length === 0,
		exitCode,
		warnings: warnings.slice(0, MAX_QUOTED),
	};
}

// ── CLI (imperative shell) ────────────────────────────────────────────────

if (import.meta.main) {
	const { emit, flag, readText, runLink } = await import("./shell");
	const argv = process.argv.slice(2);
	const exit = Number(flag(argv, "--exit"));
	const log = readText(flag(argv, "--log"));
	emit(
		"docs-build",
		flag(argv, "--out"),
		Number.isInteger(exit) && log !== undefined
			? {
					ok: true,
					value: docsBuildEvidence(
						exit,
						log,
						flag(argv, "--link") ?? runLink(process.env),
					),
				}
			: { ok: false, error: "--exit <code> and --log <file> are required" },
	);
}
