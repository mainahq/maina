#!/usr/bin/env bun
/**
 * Wave 4 / G13 regression guard — scripts/check-paths.ts.
 *
 * Walks every TypeScript source file under `packages/` (excluding tests
 * and build output) and fails the build if any `join(…)` call contains
 * two literal `.maina` segments. Two literals inside a single join()
 * are the hallmark of the "double-.maina" foot-gun the wave 1–3 work
 * almost re-introduced when new callers started forwarding a
 * `mainaDir` parameter that was actually the repo root.
 *
 * Exit 0 = clean. Exit 1 = one or more matches; each printed with
 * file:line for grep-to-IDE navigation.
 *
 * Run manually:
 *     bun scripts/check-paths.ts
 *
 * CI wires this in via `bun run check:paths`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DOUBLE_DOT_MAINA =
	/join\([^)]*["']\.maina["'][^)]*["']\.maina["'][^)]*\)/;

const ROOT = join(import.meta.dir, "..");
const ROOTS_TO_WALK = ["packages"];
const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"build",
	".git",
	"__tests__",
	"__fixtures__",
	"coverage",
]);
const ALLOWED_EXT = new Set([".ts", ".tsx", ".mts", ".cts"]);

interface Hit {
	file: string;
	line: number;
	text: string;
}

function walk(dir: string, hits: Hit[]): void {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of entries) {
		if (SKIP_DIRS.has(name)) continue;
		const full = join(dir, name);
		let stats: ReturnType<typeof statSync>;
		try {
			stats = statSync(full);
		} catch {
			continue;
		}
		if (stats.isDirectory()) {
			walk(full, hits);
			continue;
		}
		if (!stats.isFile()) continue;
		const dot = name.lastIndexOf(".");
		if (dot < 0) continue;
		if (!ALLOWED_EXT.has(name.slice(dot))) continue;
		scanFile(full, hits);
	}
}

function scanFile(path: string, hits: Hit[]): void {
	let body: string;
	try {
		body = readFileSync(path, "utf-8");
	} catch {
		return;
	}
	const lines = body.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		if (DOUBLE_DOT_MAINA.test(line)) {
			hits.push({ file: path, line: i + 1, text: line.trim() });
		}
	}
}

function main(): void {
	const hits: Hit[] = [];
	for (const rel of ROOTS_TO_WALK) {
		walk(join(ROOT, rel), hits);
	}
	if (hits.length === 0) {
		// eslint-disable-next-line no-console
		console.log("check-paths: OK — no literal `.maina/.maina/` joins found.");
		process.exit(0);
	}
	// eslint-disable-next-line no-console
	console.error(
		`check-paths: FAIL — ${hits.length} literal '.maina/.maina/' join(…) call(s) detected.`,
	);
	for (const h of hits) {
		// eslint-disable-next-line no-console
		console.error(`  ${relative(ROOT, h.file)}:${h.line}  ${h.text}`);
	}
	// eslint-disable-next-line no-console
	console.error(
		"\nFix: pass the repo root (not the `.maina` dir) and rely on the " +
			"internal `.maina/` segment. See G13 / numbering.no-double.test.ts.",
	);
	process.exit(1);
}

main();
