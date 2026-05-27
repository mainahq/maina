/**
 * Verify Ignore — default file/directory exclusions for the verify pipeline.
 *
 * Bundled artifacts (dist/, build/, *.min.js, ncc/esbuild/rollup output)
 * are not source code; running pattern-based slop detection on a minified
 * bundle produces tens of thousands of false positives (#207). These are
 * filtered out before any verify tool sees the file list.
 *
 * Project-local extras live in `.maina/ignore`, one pattern per line, `#` for
 * comments. The matcher is a deliberately small subset of `.gitignore` — see
 * the comment on `matchesPattern` for the exact supported syntax and the
 * features that are NOT implemented (negation, `**`, character classes).
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
 *   3. Each pattern in `extraPatterns` evaluated with the matcher described
 *      on `matchesPattern` (small `.gitignore` subset; not a full
 *      implementation).
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
 * Pattern matcher for `.maina/ignore`. This is a deliberately small subset
 * of `.gitignore` — enough for the hand-written project-local extras we
 * expect (block a fixture dir, ignore a `*.snap` suffix) without pulling in
 * `ignore` or `micromatch`.
 *
 * Supported (with the same semantics gitignore uses):
 *
 *   - `foo/`           — directory; matches any path with `foo` as a segment.
 *   - `foo`            — bare name; matches `foo` as a segment (file or dir).
 *   - `/foo`           — anchored to the repo root; only matches `foo` and
 *                        files inside `foo/`.
 *   - `*.snap`         — suffix glob; the leading `*` matches any chars
 *                        (including none) inside one path segment.
 *   - `dir/*.js`       — directory + suffix glob; `*` matches within a
 *                        single segment, so `dir/a.js` matches but
 *                        `dir/sub/a.js` does NOT.
 *
 * Explicitly NOT supported (so we don't surprise users who reach for them):
 *
 *   - `**` recursive globs            (use a directory pattern instead)
 *   - `!pattern` negation             (no allow-listing)
 *   - `[a-z]` character classes
 *   - `?` single-char wildcards
 *   - Patterns with more than one `*`
 *   - Mid-segment matching of bare names other than via `*.suffix`
 */
function matchesPattern(norm: string, raw: string): boolean {
	const pattern = raw.trim();
	if (pattern.length === 0 || pattern.startsWith("#")) return false;

	const anchored = pattern.startsWith("/");
	let body = anchored ? pattern.slice(1) : pattern;

	// Trailing slash → directory match (gitignore convention).
	const isDirOnly = body.endsWith("/");
	if (isDirOnly) body = body.slice(0, -1);

	// Pure suffix glob, e.g. *.snap — `*` matches within a single segment.
	if (body.startsWith("*.")) {
		const suffix = body.slice(1).toLowerCase();
		const lower = norm.toLowerCase();
		if (!lower.endsWith(suffix)) return false;
		// Ensure the `*` did not span a `/` — final segment must contain
		// the entire match.
		const segStart = lower.lastIndexOf("/") + 1;
		return lower.indexOf(suffix, segStart) !== -1;
	}

	// `dir/*.js` style — directory prefix + single-segment suffix glob.
	// The `*` must NOT cross a `/`, so `dir/*.js` matches `dir/a.js` but not
	// `dir/sub/a.js`. Patterns with more than one `*` are unsupported.
	const starIdx = body.indexOf("*");
	if (starIdx !== -1) {
		if (body.indexOf("*", starIdx + 1) !== -1) return false;
		const prefix = body.slice(0, starIdx);
		const suffix = body.slice(starIdx + 1);
		const tryMatch = (hay: string, hayStart: number) => {
			if (!hay.startsWith(prefix, hayStart)) return false;
			const tailStart = hayStart + prefix.length;
			if (!hay.endsWith(suffix)) return false;
			const tailEnd = hay.length - suffix.length;
			if (tailEnd < tailStart) return false;
			// The wildcard span must not include a path separator.
			return (
				hay.indexOf("/", tailStart) === -1 ||
				hay.indexOf("/", tailStart) >= tailEnd
			);
		};
		if (anchored) return tryMatch(norm, 0);
		// Non-anchored: try every segment boundary as the prefix start.
		if (tryMatch(norm, 0)) return true;
		for (let i = 0; i < norm.length; i++) {
			if (norm[i] === "/" && tryMatch(norm, i + 1)) return true;
		}
		return false;
	}

	// Bare name or `dir/` — match the segment anywhere in the path (for
	// non-anchored patterns) or only at the path root (anchored). A
	// trailing-slash pattern (`dir/`) requires the name to appear as a
	// directory segment, never as a bare file basename.
	if (anchored) {
		if (isDirOnly) return norm.startsWith(`${body}/`);
		return norm === body || norm.startsWith(`${body}/`);
	}
	if (!isDirOnly && norm === body) return true;
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
 * Reads optional patterns from `<cwd>/.maina/ignore` (one pattern per line,
 * `#` comments) and merges them with the built-in defaults. The pattern
 * syntax is the small `.gitignore` subset documented on `matchesPattern`,
 * not full gitignore. Missing or unreadable files are silently treated as
 * empty.
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
