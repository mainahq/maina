/**
 * Verify Ignore — default file/directory exclusions for the verify pipeline.
 *
 * Bundled artifacts (dist/, build/, *.min.js, ncc/esbuild/rollup output)
 * are not source code; running pattern-based slop detection on a minified
 * bundle produces tens of thousands of false positives (#207). These are
 * filtered out before any verify tool sees the file list.
 *
 * Honors both the built-in defaults below and any patterns listed in
 * `.maina/ignore` (gitignore-style, one pattern per line, `#` for comments).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Patterns ─────────────────────────────────────────────────────────────

/**
 * Directory names whose contents are always skipped. Matched as path segments
 * — `dist/index.js` is ignored, but `distribute/foo.ts` is not.
 */
export const DEFAULT_IGNORE_DIRS: readonly string[] = [
	"node_modules",
	"dist",
	"build",
	"out",
	".next",
	".nuxt",
	".svelte-kit",
	".turbo",
	".vercel",
	".netlify",
	".output",
	".cache",
	"coverage",
	"target", // Rust/Java
	"vendor", // Go/PHP
	".venv",
	"__pycache__",
	".pytest_cache",
	".tox",
	".mypy_cache",
	".gradle",
	".idea",
	".vscode-test",
];

/**
 * Filename suffix patterns that mark bundled or minified output.
 * Suffix-only is enough to catch the common ncc/esbuild/rollup/webpack
 * outputs without inspecting file contents.
 */
export const DEFAULT_IGNORE_SUFFIXES: readonly string[] = [
	".min.js",
	".min.css",
	".min.mjs",
	".min.cjs",
	".bundle.js",
	".bundle.mjs",
	".bundle.cjs",
	"-bundle.js",
	".chunk.js",
	".d.ts", // declaration files — not user source
	".map", // source maps
];

// ─── Path Helpers ─────────────────────────────────────────────────────────

/**
 * Normalize a path to forward slashes so the same pattern works on Windows.
 */
function normalize(p: string): string {
	return p.replace(/\\/g, "/");
}

function pathSegments(p: string): string[] {
	return normalize(p)
		.split("/")
		.filter((s) => s.length > 0);
}

// ─── Core Predicate ────────────────────────────────────────────────────────

/**
 * Returns true when the file should be excluded from verify.
 *
 * Checks (in order):
 *   1. Path segments against `DEFAULT_IGNORE_DIRS` plus any `extraDirs`.
 *   2. Filename suffix against `DEFAULT_IGNORE_SUFFIXES`.
 *   3. Any gitignore-style pattern in `extraPatterns` (substring match for
 *      simple `foo/bar` style entries; `*` glob handled minimally).
 */
export function isIgnored(
	file: string,
	options?: {
		extraDirs?: readonly string[];
		extraPatterns?: readonly string[];
	},
): boolean {
	const norm = normalize(file);
	const segments = pathSegments(norm);
	const lower = norm.toLowerCase();

	const dirSet = new Set<string>([
		...DEFAULT_IGNORE_DIRS,
		...(options?.extraDirs ?? []),
	]);
	for (const seg of segments) {
		if (dirSet.has(seg)) return true;
	}

	for (const suffix of DEFAULT_IGNORE_SUFFIXES) {
		if (lower.endsWith(suffix)) return true;
	}

	for (const pattern of options?.extraPatterns ?? []) {
		if (matchesPattern(norm, pattern)) return true;
	}

	return false;
}

/**
 * Tiny gitignore-flavoured matcher — covers the cases that show up in a
 * hand-written `.maina/ignore`. We do not pull in `ignore` or `micromatch`
 * just to keep the dependency footprint small.
 *
 *   - `foo/bar`         → substring match
 *   - `foo/*.js`        → directory prefix + suffix
 *   - `*.snap`          → suffix
 *   - `/path/to/thing`  → anchored prefix match (leading slash trimmed)
 */
function matchesPattern(norm: string, raw: string): boolean {
	const pattern = raw.trim();
	if (pattern.length === 0 || pattern.startsWith("#")) return false;

	const anchored = pattern.startsWith("/");
	let body = anchored ? pattern.slice(1) : pattern;

	// Trailing slash → directory match (gitignore convention).
	const isDirOnly = body.endsWith("/");
	if (isDirOnly) body = body.slice(0, -1);

	// Pure suffix glob, e.g. *.snap
	if (body.startsWith("*.")) {
		return norm.toLowerCase().endsWith(body.slice(1).toLowerCase());
	}

	// `dir/*.js` style — directory prefix + suffix
	const starIdx = body.indexOf("*");
	if (starIdx !== -1) {
		const prefix = body.slice(0, starIdx);
		const suffix = body.slice(starIdx + 1);
		if (anchored) {
			return norm.startsWith(prefix) && norm.endsWith(suffix);
		}
		return norm.includes(prefix) && norm.endsWith(suffix);
	}

	// Directory-style (foo/) or bare name (foo) — match the segment anywhere
	// in the path. For anchored patterns the segment must start the path.
	if (anchored) {
		return norm === body || norm.startsWith(`${body}/`);
	}
	if (norm === body) return true;
	if (norm.startsWith(`${body}/`)) return true;
	if (norm.includes(`/${body}/`)) return true;
	if (!isDirOnly && norm.endsWith(`/${body}`)) return true;
	return false;
}

// ─── File Filter ───────────────────────────────────────────────────────────

export interface FilterIgnoredResult {
	kept: string[];
	ignored: string[];
}

/**
 * Filter a list of file paths, removing ignored ones.
 *
 * Reads `<cwd>/.maina/ignore` (gitignore-style, optional) and merges its
 * patterns with the built-in defaults. Missing or unreadable files are
 * silently treated as empty.
 */
export function filterIgnoredFiles(
	files: readonly string[],
	cwd?: string,
): FilterIgnoredResult {
	const extras = loadMainaIgnore(cwd ?? process.cwd());
	const kept: string[] = [];
	const ignored: string[] = [];
	for (const file of files) {
		if (isIgnored(file, { extraPatterns: extras })) {
			ignored.push(file);
		} else {
			kept.push(file);
		}
	}
	return { kept, ignored };
}

/**
 * Read `.maina/ignore` if present. Returns the list of non-comment,
 * non-empty pattern lines.
 */
export function loadMainaIgnore(cwd: string): string[] {
	const path = join(cwd, ".maina", "ignore");
	if (!existsSync(path)) return [];
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return [];
	}
	return raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}
