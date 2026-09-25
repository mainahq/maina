/**
 * Doc Claims Verifier — catches fabricated API signatures in markdown.
 *
 * Real-world bug this prevents (issue #180): a subagent asked to "summarize the
 * public API surface" of a workspace package returned a narrative that mixed
 * real exports with plausible-looking fabrications. The fabrications shipped to
 * docs because no verification gate compared the doc claims against source.
 *
 * Strategy (mechanical, no LLM):
 *   1. Run only on changed `.md` / `.mdx` files (diff-only filter, applied by
 *      the pipeline, narrows further).
 *   2. Parse fenced code blocks; extract `import` and `require` statements with
 *      their named/default symbols.
 *   3. Resolve the module specifier to a file on disk:
 *      - relative paths resolve against the markdown file's directory
 *      - workspace paths (`@scope/name`, `@local/name`, etc.) are resolved by
 *        scanning `<cwd>/packages/*` for a matching `package.json#name`
 *      - everything else is treated as external and skipped (we cannot verify
 *        node_modules without walking them, which is out of scope for v1)
 *   4. Read the resolved source; collect every top-level exported identifier
 *      (direct exports, `export { ... }` lists, `export { x } from ...`
 *      re-exports, namespace re-exports `export * from ...`).
 *   5. For each claimed symbol that is not in the export set, emit a warning
 *      finding pointing at the import line.
 *
 * Limitations (deliberate, documented for v1):
 *   - External packages (`react`, `lodash`, npm) are skipped — we do not walk
 *     `node_modules`.
 *   - Member-access checks (`obj.method()`) are NOT validated — that requires
 *     type information; out of scope for v1.
 *   - `export *` re-exports are accepted as a wildcard (we do not recursively
 *     enumerate the re-exported file). This trades precision for fewer false
 *     positives in v1.
 *   - Severity is `warning`, not `error`. Users may promote it via a
 *     constitution rule once the false-positive rate is well understood.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { Finding } from "../diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

interface DocImport {
	/** Module specifier as written in the doc (`@workkit/memory`, `./foo`, `react`). */
	module: string;
	/**
	 * Imported export keys to validate against the resolved source. Default
	 * imports are recorded as the literal string `"default"` (matching what
	 * `export default` produces in `collectExports`), not the local binding
	 * name in the doc — the local name is irrelevant to whether the source
	 * actually exports a default.
	 */
	symbols: string[];
	/** 1-based line number within the markdown file pointing at the import. */
	line: number;
}

interface DocClaimsResult {
	findings: Finding[];
}

interface DetectOptions {
	cwd: string;
}

// ─── Markdown parsing ─────────────────────────────────────────────────────

/**
 * Extract import / require statements from fenced code blocks in markdown.
 *
 * Inline-prose imports (outside ``` fences) are intentionally ignored — they
 * are usually narrative references, not concrete claims.
 */
export function extractMarkdownImports(
	content: string,
	_file: string,
): DocImport[] {
	const lines = content.split("\n");
	const imports: DocImport[] = [];

	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const trimmed = line.trim();

		// Toggle fence on any ``` line. We do not require a language hint.
		if (trimmed.startsWith("```")) {
			inFence = !inFence;
			continue;
		}

		if (!inFence) continue;

		// 1-based line number
		const lineNo = i + 1;

		const namedImport = parseNamedImport(line);
		if (namedImport) {
			imports.push({ ...namedImport, line: lineNo });
			continue;
		}

		const defaultImport = parseDefaultImport(line);
		if (defaultImport) {
			imports.push({ ...defaultImport, line: lineNo });
			continue;
		}

		const dyn = parseDynamicImport(line);
		if (dyn) {
			imports.push({ ...dyn, line: lineNo });
		}
	}

	return imports;
}

/** Match `import { A, B as C } from "mod";`. */
function parseNamedImport(
	line: string,
): { module: string; symbols: string[] } | null {
	const re = /import\s*(?:type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/;
	const m = re.exec(line);
	if (!m) return null;
	const symbols = (m[1] ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((s) => {
			// Handle `Foo as Bar` — we care about the source name (Foo), since
			// that is what the package must export.
			const aliasIdx = s.toLowerCase().indexOf(" as ");
			return aliasIdx === -1 ? s : s.slice(0, aliasIdx).trim();
		});
	return { module: m[2] ?? "", symbols };
}

/** Match `import Foo from "mod";`. Identifier may include `$` (e.g. `import $ from "lodash"`). */
function parseDefaultImport(
	line: string,
): { module: string; symbols: string[] } | null {
	const re = /import\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/;
	const m = re.exec(line);
	if (!m) return null;
	return { module: m[2] ?? "", symbols: ["default"] };
}

/**
 * Match `require("mod")` or `import("mod")`. We DO NOT extract destructured
 * symbols (e.g. `const { foo } = require("mod")`) — those are validated only
 * if the doc also has an explicit ES `import` form. The bare module access
 * still records the module so future iterations can verify the package
 * resolves; today the empty `symbols` array short-circuits validation.
 */
function parseDynamicImport(
	line: string,
): { module: string; symbols: string[] } | null {
	const re = /(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/;
	const m = re.exec(line);
	if (!m) return null;
	return { module: m[1] ?? "", symbols: [] };
}

// ─── Module resolution ────────────────────────────────────────────────────

/**
 * Try to resolve a module specifier to an absolute source-file path inside
 * the workspace. Returns null when the specifier looks external (npm) or
 * cannot be resolved — caller treats that as "skip".
 *
 * Pass a `pkgIndex` Map to memoize the (potentially expensive) workspace
 * package scan across many imports in one verify run.
 */
function resolveWorkspaceModule(
	specifier: string,
	docFile: string,
	cwd: string,
	pkgIndex?: Map<string, string>,
): string | null {
	// Relative imports — resolve against doc directory, then guard against
	// path traversal: a hostile doc could write a relative specifier that
	// climbs out of the workspace root, and we should refuse to read it.
	if (specifier.startsWith(".")) {
		const docDir = dirname(
			isAbsolute(docFile) ? docFile : resolve(cwd, docFile),
		);
		const base = resolve(docDir, specifier);
		const cwdAbs = resolve(cwd);
		const rel = relative(cwdAbs, base);
		if (rel.startsWith("..") || isAbsolute(rel)) {
			// Escape attempt; treat as unresolvable.
			return null;
		}
		return firstExisting([
			base,
			`${base}.ts`,
			`${base}.tsx`,
			`${base}.js`,
			join(base, "index.ts"),
			join(base, "index.tsx"),
			join(base, "index.js"),
		]);
	}

	// Workspace package — use the memoized index when provided, else scan.
	if (pkgIndex !== undefined) {
		const cached = pkgIndex.get(specifier);
		return cached ?? null;
	}

	const packagesRoot = join(cwd, "packages");
	if (!existsSync(packagesRoot)) return null;

	const candidates = collectPackageDirs(packagesRoot);
	for (const pkgDir of candidates) {
		const pkgJsonPath = join(pkgDir, "package.json");
		if (!existsSync(pkgJsonPath)) continue;

		let pkgJson: { name?: string; main?: string; module?: string };
		try {
			pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
		} catch {
			continue;
		}

		if (pkgJson.name !== specifier) continue;

		const main = pkgJson.module ?? pkgJson.main ?? "src/index.ts";
		const resolved = resolve(pkgDir, main);
		return firstExisting([
			resolved,
			`${resolved}.ts`,
			`${resolved}.tsx`,
			join(resolved, "index.ts"),
			join(resolved, "index.tsx"),
		]);
	}

	return null;
}

/**
 * Return candidate package directories under `packagesRoot`. Top-level entries
 * count, plus one extra level for `@scope/name` layouts.
 */
function collectPackageDirs(packagesRoot: string): string[] {
	const out: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(packagesRoot);
	} catch {
		return out;
	}

	for (const entry of entries) {
		const full = join(packagesRoot, entry);
		try {
			if (!statSync(full).isDirectory()) continue;
		} catch {
			continue;
		}

		if (entry.startsWith("@")) {
			// Scoped: walk one more level
			let inner: string[];
			try {
				inner = readdirSync(full);
			} catch {
				continue;
			}
			for (const sub of inner) {
				out.push(join(full, sub));
			}
		} else {
			out.push(full);
		}
	}

	return out;
}

function firstExisting(paths: string[]): string | null {
	for (const p of paths) {
		if (!existsSync(p)) continue;
		try {
			const s = statSync(p);
			if (s.isFile()) return p;
		} catch {
			// ignore
		}
	}
	return null;
}

// ─── Export collection ────────────────────────────────────────────────────

/**
 * Collect every top-level exported identifier from a TS/JS source file.
 *
 * We use regex rather than tree-sitter to keep the tool dependency-free; this
 * intentionally trades a small false-positive risk on exotic syntax for speed.
 *
 * Accepts:
 *   - `export const|let|var|function|class|enum|interface|type X`
 *   - `export default ...` → registers `default`
 *   - `export { A, B as C }` (re-exports too)
 *   - `export * from "./mod"` → returns a sentinel WILDCARD entry meaning
 *     "we don't know exhaustively, so don't flag missing names"
 */
const WILDCARD_REEXPORT = "__wildcard__";

function collectExports(source: string): Set<string> {
	const exports = new Set<string>();

	// Strip block + line comments to avoid matching examples in JSDoc.
	const stripped = source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");

	// `export * from "..."` — wildcard, give up on exhaustive checking
	if (/export\s*\*\s*from\s*["'][^"']+["']/.test(stripped)) {
		exports.add(WILDCARD_REEXPORT);
	}

	// `export default ...`
	if (/\bexport\s+default\b/.test(stripped)) {
		exports.add("default");
	}

	// `export const|let|var|function|class|enum|interface|type|async function NAME`
	const declRe =
		/\bexport\s+(?:async\s+)?(?:const|let|var|function|class|enum|interface|type|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g;
	for (const m of stripped.matchAll(declRe)) {
		if (m[1]) exports.add(m[1]);
	}

	// `export { A, B as C, default as D, type Foo, typeof Bar }` — possibly with `from "..."`.
	// TS lets each list item carry an optional `type ` or `typeof ` modifier; the
	// exported NAME is the identifier after that modifier, not the modifier itself.
	const listRe = /\bexport\s+(?:type\s+)?\{([^}]+)\}/g;
	for (const m of stripped.matchAll(listRe)) {
		const list = m[1] ?? "";
		for (const raw of list.split(",")) {
			let item = raw.trim();
			if (!item) continue;
			// Strip a leading `type ` or `typeof ` modifier on the item itself.
			item = item.replace(/^(?:type|typeof)\s+/, "");
			// `X as Y` — the EXPORTED name is Y (what consumers import).
			const aliasIdx = item.toLowerCase().indexOf(" as ");
			const exported = aliasIdx === -1 ? item : item.slice(aliasIdx + 4).trim();
			if (exported) exports.add(exported);
		}
	}

	return exports;
}

/**
 * Build a one-shot index of `package.json#name` → resolved entrypoint path
 * for every workspace package under `<cwd>/packages`. Used by
 * `detectDocClaims` so we scan the filesystem ONCE per verify run instead
 * of once per import in the changed docs.
 */
function buildPackageIndex(cwd: string): Map<string, string> {
	const idx = new Map<string, string>();
	const packagesRoot = join(cwd, "packages");
	if (!existsSync(packagesRoot)) return idx;

	for (const pkgDir of collectPackageDirs(packagesRoot)) {
		const pkgJsonPath = join(pkgDir, "package.json");
		if (!existsSync(pkgJsonPath)) continue;
		let pkgJson: { name?: string; main?: string; module?: string };
		try {
			pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
		} catch {
			continue;
		}
		if (!pkgJson.name) continue;
		const main = pkgJson.module ?? pkgJson.main ?? "src/index.ts";
		const candidate = resolve(pkgDir, main);
		const found = firstExisting([
			candidate,
			`${candidate}.ts`,
			`${candidate}.tsx`,
			`${candidate}.js`,
			join(candidate, "index.ts"),
			join(candidate, "index.tsx"),
			join(candidate, "index.js"),
		]);
		if (found) idx.set(pkgJson.name, found);
	}
	return idx;
}

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Run the doc-claims check across the given file list.
 *
 * Non-markdown files are skipped silently; markdown files that do not exist
 * or fail to read produce no findings (the slop-style robustness pattern).
 */
export async function detectDocClaims(
	files: string[],
	options: DetectOptions,
): Promise<DocClaimsResult> {
	const { cwd } = options;
	const findings: Finding[] = [];
	// One-shot scan of workspace packages so each import resolves in O(1)
	// instead of O(packages × imports).
	const pkgIndex = buildPackageIndex(cwd);

	for (const file of files) {
		if (!isMarkdown(file)) continue;

		const filePath = isAbsolute(file) ? file : resolve(cwd, file);
		let content: string;
		try {
			content = await Bun.file(filePath).text();
		} catch {
			continue;
		}

		const imports = extractMarkdownImports(content, file);
		for (const imp of imports) {
			if (imp.symbols.length === 0) continue; // dynamic import with no symbol claim

			const resolved = resolveWorkspaceModule(imp.module, file, cwd, pkgIndex);
			// External / unresolved → skip silently (documented limitation).
			if (!resolved) continue;

			let exportSet: Set<string>;
			try {
				const src = readFileSync(resolved, "utf-8");
				exportSet = collectExports(src);
			} catch {
				continue;
			}

			// `export *` swallows everything — do not emit findings against this
			// module in v1. Better to under-report than to false-positive.
			if (exportSet.has(WILDCARD_REEXPORT)) continue;

			for (const symbol of imp.symbols) {
				if (exportSet.has(symbol)) continue;
				findings.push({
					tool: "doc-claims",
					file,
					line: imp.line,
					message: `Doc imports \`${symbol}\` from \`${imp.module}\` but the resolved source does not export it. Possible fabricated API claim.`,
					severity: "warning",
					ruleId: "doc-claims/missing-export",
				});
			}
		}
	}

	return { findings };
}

function isMarkdown(file: string): boolean {
	return file.endsWith(".md") || file.endsWith(".mdx");
}
