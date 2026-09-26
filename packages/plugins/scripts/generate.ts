#!/usr/bin/env bun
/**
 * Writes every host's plugin package to `dist/<host>/` (committed: the
 * marketplaces install from the repo). `--check` writes nothing and exits 1
 * when a committed package differs from what the generator produces.
 *
 *   bun run plugins:generate
 *   bun run plugins:check
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { type GeneratedFile, generate, HOSTS } from "../src/generate";
import { loadSources } from "../src/sources";

const DIST_DIR = join(import.meta.dir, "..", "dist");

function listFiles(dir: string): readonly string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		return statSync(full).isDirectory() ? listFiles(full) : [full];
	});
}

/** Why a committed package differs from the generator's, or nothing. */
function staleness(
	dir: string,
	files: readonly GeneratedFile[],
): readonly string[] {
	const expected = new Map(files.map((f) => [f.path, f]));
	const onDisk = listFiles(dir).map((full) =>
		relative(dir, full).split(sep).join("/"),
	);
	const extra = onDisk
		.filter((path) => !expected.has(path))
		.map((p) => `extra ${p}`);
	const wrong = files.flatMap((f) => {
		const full = join(dir, f.path);
		if (!existsSync(full)) return [`missing ${f.path}`];
		if (readFileSync(full, "utf-8") !== f.content) return [`changed ${f.path}`];
		const executable = (statSync(full).mode & 0o111) !== 0;
		return process.platform !== "win32" && executable !== f.executable
			? [`mode ${f.path}`]
			: [];
	});
	return [...extra, ...wrong];
}

function write(dir: string, files: readonly GeneratedFile[]): void {
	rmSync(dir, { recursive: true, force: true });
	for (const f of files) {
		const full = join(dir, f.path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, f.content);
		chmodSync(full, f.executable ? 0o755 : 0o644);
	}
}

const check = process.argv.includes("--check");
const sources = loadSources();
const problems = HOSTS.flatMap((host) => {
	const dir = join(DIST_DIR, host);
	const files = generate(host, sources);
	if (!check) {
		write(dir, files);
		process.stdout.write(`dist/${host}: ${files.length} files\n`);
		return [];
	}
	return staleness(dir, files).map((why) => `dist/${host}: ${why}`);
});

if (problems.length > 0) {
	process.stderr.write(
		`${problems.join("\n")}\nPlugin packages are stale: run \`bun run plugins:generate\`.\n`,
	);
	process.exit(1);
}
