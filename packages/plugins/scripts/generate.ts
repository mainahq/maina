#!/usr/bin/env bun
/**
 * Writes every host's plugin package to `dist/<host>/`, the Claude Code and
 * Cursor marketplace listings to `.claude-plugin/marketplace.json` and
 * `.cursor-plugin/marketplace.json` at the repo root, and the Cursor MCP
 * install link to the docs data (all committed: the marketplaces install
 * from the repo). `--check` writes nothing and exits 1 when a committed
 * file differs from what the generator produces.
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
import { PLUGIN } from "../src/definition";
import { type GeneratedFile, generate, HOSTS } from "../src/generate";
import { cursorMcpInstall } from "../src/generate/deeplink";
import {
	claudeMarketplace,
	cursorMarketplace,
} from "../src/generate/marketplace";
import { loadSources } from "../src/sources";

const DIST_DIR = join(import.meta.dir, "..", "dist");
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

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

/** A file outside `dist/`, from the repo root, or why it is stale. */
function repoFile(generated: GeneratedFile, check: boolean): readonly string[] {
	const full = join(REPO_ROOT, generated.path);
	if (!check) {
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, generated.content);
		process.stdout.write(`${generated.path}\n`);
		return [];
	}
	if (!existsSync(full)) return [`missing ${generated.path}`];
	return readFileSync(full, "utf-8") === generated.content
		? []
		: [`changed ${generated.path}`];
}

const check = process.argv.includes("--check");
const loaded = loadSources();
if (!loaded.ok) {
	process.stderr.write(`${loaded.error}\n`);
	process.exit(1);
}
const sources = loaded.value;
const problems = [
	...HOSTS.flatMap((host) => {
		const dir = join(DIST_DIR, host);
		const files = generate(host, sources);
		if (!check) {
			write(dir, files);
			process.stdout.write(`dist/${host}: ${files.length} files\n`);
			return [];
		}
		return staleness(dir, files).map((why) => `dist/${host}: ${why}`);
	}),
	...[
		claudeMarketplace(PLUGIN),
		cursorMarketplace(PLUGIN),
		cursorMcpInstall(PLUGIN, sources.version),
	].flatMap((f) => repoFile(f, check)),
];

if (problems.length > 0) {
	process.stderr.write(
		`${problems.join("\n")}\nPlugin packages are stale: run \`bun run plugins:generate\`.\n`,
	);
	process.exit(1);
}
