/**
 * Setup — Stack-Context Assembler
 *
 * Builds a `StackContext` describing a repository's languages, frameworks,
 * tooling, CI, and size. Used by the universal setup wizard to produce a
 * tailored constitution and verify plan with a single LLM call.
 *
 * Pure detection — no AI or network calls.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Result } from "../db/index";
import { detectFileLanguage, detectLanguages } from "../language/detect";
import { detectExistingRuleFiles as _detectExistingRuleFiles } from "./adopt";

// ── Types ────────────────────────────────────────────────────────────────────

export type PackageManager =
	| "bun"
	| "npm"
	| "pnpm"
	| "yarn"
	| "pip"
	| "cargo"
	| "go"
	| "unknown";

export interface RepoSize {
	files: number;
	bytes: number;
}

export interface StackContext {
	languages: string[];
	frameworks: string[];
	packageManager: PackageManager;
	buildTool: string | null;
	linters: string[];
	testRunners: string[];
	cicd: string[];
	repoSize: RepoSize;
	subprojects?: StackContext[];
	isEmpty: boolean;
	isLarge: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const LARGE_REPO_THRESHOLD = 10_000;
const WALK_HARD_CAP = 12_000; // walk slightly past threshold to flag isLarge
const MAX_SUMMARY_CHARS = 40_000;
const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	".next",
	".turbo",
	".cache",
	"coverage",
	".venv",
	"venv",
	"__pycache__",
	"target",
	".idea",
	".vscode",
	".maina",
]);

const FRAMEWORK_DEPS: Record<string, string> = {
	next: "next.js",
	react: "react",
	vue: "vue",
	svelte: "svelte",
	"@sveltejs/kit": "sveltekit",
	astro: "astro",
	nuxt: "nuxt",
	"solid-js": "solidjs",
	fastify: "fastify",
	hono: "hono",
	express: "express",
	"@nestjs/core": "nestjs",
	koa: "koa",
	elysia: "elysia",
	remix: "remix",
	"@remix-run/node": "remix",
};

const LINTER_DEPS: Record<string, string> = {
	"@biomejs/biome": "biome",
	eslint: "eslint",
	prettier: "prettier",
	oxlint: "oxlint",
	"standard-version": "standard",
};

const TEST_RUNNER_DEPS: Record<string, string> = {
	vitest: "vitest",
	jest: "jest",
	"@jest/core": "jest",
	mocha: "mocha",
	ava: "ava",
	playwright: "playwright",
	"@playwright/test": "playwright",
	cypress: "cypress",
};

const BUILD_TOOL_DEPS: Record<string, string> = {
	bunup: "bunup",
	tsup: "tsup",
	vite: "vite",
	webpack: "webpack",
	esbuild: "esbuild",
	rollup: "rollup",
	turbo: "turborepo",
	nx: "nx",
	parcel: "parcel",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeReadJson(path: string): Record<string, unknown> | null {
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function safeReadText(path: string): string | null {
	try {
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}

function collectDeps(
	pkg: Record<string, unknown> | null,
): Record<string, string> {
	if (!pkg) return {};
	return {
		...(pkg.dependencies as Record<string, string> | undefined),
		...(pkg.devDependencies as Record<string, string> | undefined),
		...(pkg.peerDependencies as Record<string, string> | undefined),
		...(pkg.optionalDependencies as Record<string, string> | undefined),
	};
}

function detectPackageManager(cwd: string): PackageManager {
	// Prefer JS lockfiles first, then other ecosystems.
	if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) {
		return "bun";
	}
	if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
	if (existsSync(join(cwd, "package-lock.json"))) return "npm";
	if (
		existsSync(join(cwd, "poetry.lock")) ||
		existsSync(join(cwd, "pyproject.toml")) ||
		existsSync(join(cwd, "requirements.txt")) ||
		existsSync(join(cwd, "Pipfile"))
	) {
		return "pip";
	}
	if (
		existsSync(join(cwd, "Cargo.lock")) ||
		existsSync(join(cwd, "Cargo.toml"))
	) {
		return "cargo";
	}
	if (existsSync(join(cwd, "go.sum")) || existsSync(join(cwd, "go.mod"))) {
		return "go";
	}
	return "unknown";
}

function detectFrameworks(cwd: string, deps: Record<string, string>): string[] {
	const frameworks = new Set<string>();

	for (const [dep, name] of Object.entries(FRAMEWORK_DEPS)) {
		if (deps[dep]) frameworks.add(name);
	}

	// Python frameworks from pyproject.toml / requirements.txt (best-effort)
	const pyproject = safeReadText(join(cwd, "pyproject.toml"));
	const requirements = safeReadText(join(cwd, "requirements.txt"));
	const pyBlob = `${pyproject ?? ""}\n${requirements ?? ""}`.toLowerCase();
	if (pyBlob.includes("django")) frameworks.add("django");
	if (pyBlob.includes("flask")) frameworks.add("flask");
	if (pyBlob.includes("fastapi")) frameworks.add("fastapi");

	// Go: parse go.mod imports (light touch)
	const goMod = safeReadText(join(cwd, "go.mod"));
	if (goMod) {
		if (goMod.includes("gin-gonic/gin")) frameworks.add("gin");
		if (goMod.includes("labstack/echo")) frameworks.add("echo");
		if (goMod.includes("gofiber/fiber")) frameworks.add("fiber");
	}

	// Rust: parse Cargo.toml
	const cargo = safeReadText(join(cwd, "Cargo.toml"));
	if (cargo) {
		if (cargo.includes("axum")) frameworks.add("axum");
		if (cargo.includes("actix-web")) frameworks.add("actix");
		if (cargo.includes("rocket")) frameworks.add("rocket");
	}

	return [...frameworks].sort();
}

function detectBuildTool(
	deps: Record<string, string>,
	scripts: Record<string, string>,
): string | null {
	for (const [dep, name] of Object.entries(BUILD_TOOL_DEPS)) {
		if (deps[dep]) return name;
	}
	const scriptBlob = Object.values(scripts).join(" ").toLowerCase();
	for (const [dep, name] of Object.entries(BUILD_TOOL_DEPS)) {
		if (scriptBlob.includes(dep)) return name;
	}
	return null;
}

function detectLinters(cwd: string, deps: Record<string, string>): string[] {
	const linters = new Set<string>();
	for (const [dep, name] of Object.entries(LINTER_DEPS)) {
		if (deps[dep]) linters.add(name);
	}
	// Config-file heuristics
	if (
		existsSync(join(cwd, "biome.json")) ||
		existsSync(join(cwd, "biome.jsonc"))
	) {
		linters.add("biome");
	}
	if (
		existsSync(join(cwd, ".eslintrc")) ||
		existsSync(join(cwd, ".eslintrc.js")) ||
		existsSync(join(cwd, ".eslintrc.cjs")) ||
		existsSync(join(cwd, ".eslintrc.json")) ||
		existsSync(join(cwd, "eslint.config.js")) ||
		existsSync(join(cwd, "eslint.config.mjs"))
	) {
		linters.add("eslint");
	}
	if (
		existsSync(join(cwd, ".prettierrc")) ||
		existsSync(join(cwd, ".prettierrc.json")) ||
		existsSync(join(cwd, "prettier.config.js"))
	) {
		linters.add("prettier");
	}
	// Python: ruff / black
	const pyproject = safeReadText(join(cwd, "pyproject.toml"));
	if (pyproject?.includes("[tool.ruff")) linters.add("ruff");
	if (pyproject?.includes("[tool.black")) linters.add("black");
	// Rust: clippy is implicit if Cargo.toml exists
	if (existsSync(join(cwd, "Cargo.toml"))) linters.add("clippy");
	// Go
	if (
		existsSync(join(cwd, ".golangci.yml")) ||
		existsSync(join(cwd, ".golangci.yaml"))
	) {
		linters.add("golangci-lint");
	}
	return [...linters].sort();
}

function detectTestRunners(
	cwd: string,
	deps: Record<string, string>,
	pkgManager: PackageManager,
	languages: string[],
): string[] {
	const runners = new Set<string>();
	for (const [dep, name] of Object.entries(TEST_RUNNER_DEPS)) {
		if (deps[dep]) runners.add(name);
	}
	// bun:test is implicit for bun projects (no package dep)
	if (pkgManager === "bun") runners.add("bun:test");

	// Python: pytest from pyproject.toml / requirements.txt
	const pyBlob = `${safeReadText(join(cwd, "pyproject.toml")) ?? ""}\n${
		safeReadText(join(cwd, "requirements.txt")) ?? ""
	}`.toLowerCase();
	if (pyBlob.includes("pytest")) runners.add("pytest");

	// Go / Rust / Java implicit test runners
	if (languages.includes("go")) runners.add("go test");
	if (languages.includes("rust")) runners.add("cargo test");
	if (languages.includes("java")) runners.add("junit");

	return [...runners].sort();
}

function detectCicd(cwd: string): string[] {
	const cicd: string[] = [];
	if (existsSync(join(cwd, ".github", "workflows"))) {
		try {
			const entries = readdirSync(join(cwd, ".github", "workflows"));
			if (entries.some((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
				cicd.push("github-actions");
			}
		} catch {}
	}
	if (existsSync(join(cwd, ".gitlab-ci.yml"))) cicd.push("gitlab-ci");
	if (existsSync(join(cwd, ".circleci"))) cicd.push("circleci");
	if (existsSync(join(cwd, "azure-pipelines.yml")))
		cicd.push("azure-pipelines");
	if (
		existsSync(join(cwd, "Jenkinsfile")) ||
		existsSync(join(cwd, "jenkinsfile"))
	) {
		cicd.push("jenkins");
	}
	if (existsSync(join(cwd, ".drone.yml"))) cicd.push("drone");
	if (
		existsSync(join(cwd, ".travis.yml")) ||
		existsSync(join(cwd, "travis.yml"))
	) {
		cicd.push("travis");
	}
	return cicd.sort();
}

/**
 * Walk the repo counting files and bytes, detecting language extensions.
 * Stops at WALK_HARD_CAP to bound cost on very large repos.
 * Returns the (possibly-capped) counts and a set of seen extensions.
 */
function walkRepo(root: string): {
	files: number;
	bytes: number;
	exts: Set<string>;
	capped: boolean;
} {
	let files = 0;
	let bytes = 0;
	let capped = false;
	const exts = new Set<string>();

	const stack: string[] = [root];
	while (stack.length > 0) {
		if (files >= WALK_HARD_CAP) {
			capped = true;
			break;
		}
		const dir = stack.pop();
		if (!dir) break;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (IGNORED_DIRS.has(entry)) continue;
			if (entry.startsWith(".") && entry !== ".github") continue;
			const full = join(dir, entry);
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(full);
			} catch {
				continue;
			}
			if (st.isDirectory()) {
				stack.push(full);
			} else if (st.isFile()) {
				files += 1;
				bytes += st.size;
				const ext = extname(entry).toLowerCase();
				if (ext) exts.add(ext);
				if (files >= WALK_HARD_CAP) {
					capped = true;
					break;
				}
			}
		}
	}
	return { files, bytes, exts, capped };
}

/**
 * Fallback language detection from file extensions — used when no marker
 * files (tsconfig, pyproject.toml, etc.) are present.
 */
function languagesFromExtensions(exts: Set<string>): string[] {
	const langs = new Set<string>();
	for (const ext of exts) {
		const lang = detectFileLanguage(`dummy${ext}`);
		if (lang) langs.add(lang);
	}
	return [...langs].sort();
}

function looksLikeSubproject(dir: string): boolean {
	return (
		existsSync(join(dir, "package.json")) ||
		existsSync(join(dir, "pyproject.toml")) ||
		existsSync(join(dir, "Cargo.toml")) ||
		existsSync(join(dir, "go.mod"))
	);
}

/** Return absolute paths to direct child subproject dirs (one level deep). */
function findSubprojectDirs(cwd: string): string[] {
	const roots = ["packages", "apps", "services", "libs", "crates"];
	const found: string[] = [];
	for (const root of roots) {
		const rootDir = join(cwd, root);
		if (!existsSync(rootDir)) continue;
		let entries: string[];
		try {
			entries = readdirSync(rootDir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.startsWith(".")) continue;
			const full = join(rootDir, entry);
			try {
				if (statSync(full).isDirectory() && looksLikeSubproject(full)) {
					found.push(full);
				}
			} catch {}
		}
	}
	return found;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Assemble a StackContext for the given repo root.
 *
 * Combines marker-file detection, package.json/lockfile analysis, and a
 * bounded file walk to produce a self-contained snapshot that the setup
 * wizard can feed into a universal prompt.
 *
 * Never throws — unreadable paths return `{ ok: false, error }`.
 * When `recurse` is false, subprojects are not recursed into (used by the
 * subproject scan itself to avoid unbounded recursion).
 */
export async function assembleStackContext(
	cwd: string,
	opts: { recurse?: boolean } = {},
): Promise<Result<StackContext, string>> {
	const recurse = opts.recurse !== false;

	if (!existsSync(cwd)) {
		return { ok: false, error: `Path does not exist: ${cwd}` };
	}
	let rootStat: ReturnType<typeof statSync>;
	try {
		rootStat = statSync(cwd);
	} catch (e) {
		return { ok: false, error: `Cannot stat ${cwd}: ${String(e)}` };
	}
	if (!rootStat.isDirectory()) {
		return { ok: false, error: `Not a directory: ${cwd}` };
	}

	// Walk first so we have extension data for fallback language detection.
	const walk = walkRepo(cwd);

	// Marker-based language detection
	const markerLangs = detectLanguages(cwd);
	const extLangs = languagesFromExtensions(walk.exts);
	const languages = [...new Set([...markerLangs, ...extLangs])].sort();

	const pkg = safeReadJson(join(cwd, "package.json"));
	const deps = collectDeps(pkg);
	const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {};

	const packageManager = detectPackageManager(cwd);
	const frameworks = detectFrameworks(cwd, deps);
	const buildTool = detectBuildTool(deps, scripts);
	const linters = detectLinters(cwd, deps);
	const testRunners = detectTestRunners(cwd, deps, packageManager, languages);
	const cicd = detectCicd(cwd);

	// Subprojects (monorepo detection)
	let subprojects: StackContext[] | undefined;
	if (recurse) {
		const dirs = findSubprojectDirs(cwd);
		if (dirs.length > 0) {
			subprojects = [];
			for (const dir of dirs) {
				const sub = await assembleStackContext(dir, { recurse: false });
				if (sub.ok) subprojects.push(sub.value);
			}
		}
	}

	const isEmpty = walk.files === 0 && languages.length === 0;
	const isLarge = walk.capped || walk.files >= LARGE_REPO_THRESHOLD;

	const ctx: StackContext = {
		languages,
		frameworks,
		packageManager,
		buildTool,
		linters,
		testRunners,
		cicd,
		repoSize: { files: walk.files, bytes: walk.bytes },
		isEmpty,
		isLarge,
	};
	if (subprojects !== undefined) ctx.subprojects = subprojects;

	return { ok: true, value: ctx };
}

/**
 * Deterministic SHA-256 hash of a StackContext.
 * Array ordering does not affect the result — all arrays are sorted before hashing.
 * Subprojects are sorted by their own hash and included recursively.
 */
export function contextHash(ctx: StackContext): string {
	const normalized = normalizeForHash(ctx);
	const json = JSON.stringify(normalized);
	return createHash("sha256").update(json).digest("hex");
}

function normalizeForHash(ctx: StackContext): Record<string, unknown> {
	const sortedSubs = (ctx.subprojects ?? [])
		.map((s) => normalizeForHash(s))
		.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
	return {
		languages: [...ctx.languages].sort(),
		frameworks: [...ctx.frameworks].sort(),
		packageManager: ctx.packageManager,
		buildTool: ctx.buildTool,
		linters: [...ctx.linters].sort(),
		testRunners: [...ctx.testRunners].sort(),
		cicd: [...ctx.cicd].sort(),
		repoSize: ctx.repoSize,
		isEmpty: ctx.isEmpty,
		isLarge: ctx.isLarge,
		subprojects: sortedSubs,
	};
}

// ── Repo Summary ─────────────────────────────────────────────────────────────

/**
 * Produce a short markdown summary of the repo (capped at ~40k chars).
 * Used as the `{repoSummary}` input to the universal setup prompt.
 * For large repos, samples strategically: top-level dirs + key entrypoints.
 */
export async function summarizeRepo(
	cwd: string,
	ctx: StackContext,
): Promise<string> {
	const lines: string[] = [];
	lines.push("# Repo Summary");
	lines.push("");
	lines.push(
		`- Files: ${ctx.repoSize.files}${ctx.isLarge ? " (sampled — large repo)" : ""}`,
	);
	lines.push(`- Bytes: ${ctx.repoSize.bytes}`);
	lines.push(`- Languages: ${ctx.languages.join(", ") || "(none detected)"}`);
	lines.push(`- Frameworks: ${ctx.frameworks.join(", ") || "(none detected)"}`);
	lines.push(`- Package manager: ${ctx.packageManager}`);
	lines.push(`- Build tool: ${ctx.buildTool ?? "(none)"}`);
	lines.push(`- Linters: ${ctx.linters.join(", ") || "(none)"}`);
	lines.push(`- Test runners: ${ctx.testRunners.join(", ") || "(none)"}`);
	lines.push(`- CI/CD: ${ctx.cicd.join(", ") || "(none)"}`);
	lines.push("");

	// Top-level tree
	lines.push("## Top-level entries");
	lines.push("");
	try {
		const entries = readdirSync(cwd)
			.filter((e) => !IGNORED_DIRS.has(e))
			.sort();
		for (const entry of entries.slice(0, 80)) {
			const full = join(cwd, entry);
			try {
				const st = statSync(full);
				lines.push(`- ${entry}${st.isDirectory() ? "/" : ""}`);
			} catch {
				lines.push(`- ${entry}`);
			}
		}
	} catch {
		lines.push("(unreadable)");
	}
	lines.push("");

	// Package.json highlights
	const pkg = safeReadJson(join(cwd, "package.json"));
	if (pkg) {
		lines.push("## package.json");
		lines.push("");
		if (typeof pkg.name === "string") lines.push(`- name: ${pkg.name}`);
		if (typeof pkg.version === "string")
			lines.push(`- version: ${pkg.version}`);
		if (typeof pkg.description === "string") {
			lines.push(`- description: ${pkg.description}`);
		}
		const scripts = pkg.scripts as Record<string, string> | undefined;
		if (scripts) {
			lines.push("- scripts:");
			for (const [k, v] of Object.entries(scripts).slice(0, 20)) {
				lines.push(`  - ${k}: ${v}`);
			}
		}
		lines.push("");
	}

	// Key entrypoints
	const entrypoints = [
		"src/index.ts",
		"src/main.ts",
		"src/index.js",
		"index.ts",
		"index.js",
		"main.py",
		"cmd/main.go",
		"src/main.rs",
	];
	const found = entrypoints.filter((p) => existsSync(join(cwd, p)));
	if (found.length > 0) {
		lines.push("## Entrypoints");
		lines.push("");
		for (const p of found) lines.push(`- ${p}`);
		lines.push("");
	}

	// Subprojects summary
	if (ctx.subprojects && ctx.subprojects.length > 0) {
		lines.push("## Subprojects");
		lines.push("");
		for (const sub of ctx.subprojects.slice(0, 40)) {
			lines.push(
				`- langs=${sub.languages.join("|") || "-"}, frameworks=${
					sub.frameworks.join("|") || "-"
				}, files=${sub.repoSize.files}`,
			);
		}
		lines.push("");
	}

	// Existing rule/instruction files — useful signal for the tailor prompt.
	const ruleFiles = _detectExistingRuleFiles(cwd);
	if (ruleFiles.length > 0) {
		lines.push("## Existing rule files");
		lines.push("");
		for (const f of ruleFiles.slice(0, 20)) {
			lines.push(`- ${f}`);
		}
		lines.push("");
	}

	let out = lines.join("\n");
	if (out.length > MAX_SUMMARY_CHARS) {
		out = `${out.slice(0, MAX_SUMMARY_CHARS - 64)}\n\n[...truncated at ${MAX_SUMMARY_CHARS} chars]`;
	}
	return out;
}

// Re-export for convenience — callers can compute a path relative to cwd
// without importing node:path separately.
/**
 * Re-export from `adopt.ts` so existing callers importing from
 * `setup/context` can discover rule files without a second import.
 */
export {
	_detectExistingRuleFiles as detectExistingRuleFiles,
	relative as relativePath,
};
