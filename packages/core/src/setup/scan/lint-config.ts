/**
 * Lint / config scanner.
 *
 * Reads well-known config files and emits `Rule[]` describing the conventions
 * those configs already enforce. Deterministic, table-driven, no network. Each
 * emitted rule carries confidence ≥ 0.6 (lint configs are explicit machine-
 * readable intent).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "../../db/index";
import type { Rule, RuleCategory, RuleSourceKind } from "../adopt";

// ── Public API ───────────────────────────────────────────────────────────────

export async function scanLintConfig(
	cwd: string,
): Promise<Result<Rule[], string>> {
	try {
		const rules: Rule[] = [];
		rules.push(...scanBiome(cwd));
		rules.push(...scanEslint(cwd));
		rules.push(...scanPrettier(cwd));
		rules.push(...scanTsconfig(cwd));
		rules.push(...scanPyproject(cwd));
		rules.push(...scanCargo(cwd));
		rules.push(...scanGoMod(cwd));
		return { ok: true, value: rules };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

// ── Biome ────────────────────────────────────────────────────────────────────

function scanBiome(cwd: string): Rule[] {
	const path = existsSync(join(cwd, "biome.json"))
		? "biome.json"
		: existsSync(join(cwd, "biome.jsonc"))
			? "biome.jsonc"
			: null;
	if (path === null) return [];
	const data = safeReadJson(join(cwd, path));
	if (data === null) {
		// Config exists but is malformed — still emit the baseline "Biome is the
		// formatter" rule so downstream sees we detected a Biome project.
		return [
			rule({
				text: "Biome is the configured lint + formatter — run `biome check --write` before commit.",
				source: path,
				sourceKind: "biome.json",
				confidence: 0.7,
				category: "ci",
			}),
		];
	}
	const out: Rule[] = [
		rule({
			text: "Biome is the configured lint + formatter — run `biome check --write` before commit.",
			source: path,
			sourceKind: "biome.json",
			confidence: 0.9,
			category: "ci",
		}),
	];
	const linterRules =
		((data.linter as { rules?: unknown } | undefined)?.rules as
			| Record<string, Record<string, unknown>>
			| undefined) ?? {};
	const flat: Record<string, unknown> = {};
	for (const bucket of Object.values(linterRules)) {
		if (bucket && typeof bucket === "object") {
			Object.assign(flat, bucket);
		}
	}
	if (flat.noConsoleLog !== undefined && flat.noConsoleLog !== "off") {
		out.push(
			rule({
				text: "Do not commit console.log statements — Biome's noConsoleLog rule is enabled.",
				source: path,
				sourceKind: "biome.json",
				confidence: 0.9,
				category: "style",
			}),
		);
	}
	if (flat.noExplicitAny !== undefined && flat.noExplicitAny !== "off") {
		out.push(
			rule({
				text: "Avoid the `any` type — Biome's noExplicitAny rule is enabled.",
				source: path,
				sourceKind: "biome.json",
				confidence: 0.8,
				category: "style",
			}),
		);
	}
	if (
		flat.noUnusedVariables !== undefined &&
		flat.noUnusedVariables !== "off"
	) {
		out.push(
			rule({
				text: "Delete unused variables before commit — Biome flags them.",
				source: path,
				sourceKind: "biome.json",
				confidence: 0.8,
				category: "style",
			}),
		);
	}
	return out;
}

// ── ESLint ───────────────────────────────────────────────────────────────────

function scanEslint(cwd: string): Rule[] {
	// Prefer JSON-shaped configs first so rule-level parsing wins over the
	// legacy bare `.eslintrc` (YAML default) detection.
	const candidates = [
		".eslintrc.json",
		".eslintrc",
		".eslintrc.js",
		".eslintrc.cjs",
		".eslintrc.yml",
		".eslintrc.yaml",
		"eslint.config.js",
		"eslint.config.mjs",
		"eslint.config.cjs",
	];
	const path = candidates.find((c) => existsSync(join(cwd, c))) ?? null;
	if (path === null) return [];

	const out: Rule[] = [
		rule({
			text: "ESLint is configured — run `eslint .` before commit.",
			source: path,
			sourceKind: ".eslintrc",
			confidence: 0.9,
			category: "ci",
		}),
	];

	// Best-effort parse for JSON-shaped configs. JS configs are opaque.
	if (path.endsWith(".json") || path === ".eslintrc") {
		const data = safeReadJson(join(cwd, path));
		const rules = ((data?.rules as Record<string, unknown>) ?? {}) as Record<
			string,
			unknown
		>;
		if (isActive(rules["no-unused-vars"])) {
			out.push(
				rule({
					text: "Delete unused variables before commit — ESLint's no-unused-vars is enabled.",
					source: path,
					sourceKind: ".eslintrc",
					confidence: 0.8,
					category: "style",
				}),
			);
		}
		if (isActive(rules["no-console"])) {
			out.push(
				rule({
					text: "Do not commit console.log statements — ESLint's no-console is enabled.",
					source: path,
					sourceKind: ".eslintrc",
					confidence: 0.8,
					category: "style",
				}),
			);
		}
		if (isActive(rules["@typescript-eslint/no-explicit-any"])) {
			out.push(
				rule({
					text: "Avoid the `any` type — @typescript-eslint/no-explicit-any is enabled.",
					source: path,
					sourceKind: ".eslintrc",
					confidence: 0.8,
					category: "style",
				}),
			);
		}
	}
	return out;
}

// ── Prettier ─────────────────────────────────────────────────────────────────

function scanPrettier(cwd: string): Rule[] {
	const candidates = [
		".prettierrc",
		".prettierrc.json",
		".prettierrc.js",
		".prettierrc.yml",
		".prettierrc.yaml",
		"prettier.config.js",
		"prettier.config.mjs",
	];
	const path = candidates.find((c) => existsSync(join(cwd, c))) ?? null;
	if (path === null) return [];
	return [
		rule({
			text: "Prettier is configured — run `prettier --write .` before commit.",
			source: path,
			sourceKind: ".prettierrc",
			confidence: 0.8,
			category: "style",
		}),
	];
}

// ── tsconfig.json ────────────────────────────────────────────────────────────

function scanTsconfig(cwd: string): Rule[] {
	if (!existsSync(join(cwd, "tsconfig.json"))) return [];
	const data = safeReadJson(join(cwd, "tsconfig.json"));
	const out: Rule[] = [];
	const opts =
		(data?.compilerOptions as Record<string, unknown> | undefined) ?? {};
	if (opts.strict === true) {
		out.push(
			rule({
				text: "TypeScript strict mode is required — keep `strict: true` green.",
				source: "tsconfig.json",
				sourceKind: "tsconfig.json",
				confidence: 0.9,
				category: "style",
			}),
		);
	}
	if (opts.noUncheckedIndexedAccess === true) {
		out.push(
			rule({
				text: "Guard every indexed access — noUncheckedIndexedAccess is enabled.",
				source: "tsconfig.json",
				sourceKind: "tsconfig.json",
				confidence: 0.8,
				category: "error-handling",
			}),
		);
	}
	if (opts.noImplicitAny === true) {
		out.push(
			rule({
				text: "Every value needs an explicit type — noImplicitAny is enabled.",
				source: "tsconfig.json",
				sourceKind: "tsconfig.json",
				confidence: 0.8,
				category: "style",
			}),
		);
	}
	return out;
}

// ── pyproject.toml ───────────────────────────────────────────────────────────

function scanPyproject(cwd: string): Rule[] {
	if (!existsSync(join(cwd, "pyproject.toml"))) return [];
	const text = safeReadText(join(cwd, "pyproject.toml"));
	if (text === null) return [];
	const out: Rule[] = [];
	if (/\[tool\.ruff\b/.test(text)) {
		out.push(
			rule({
				text: "Run ruff before committing Python — `[tool.ruff]` is configured.",
				source: "pyproject.toml",
				sourceKind: "pyproject.toml",
				confidence: 0.8,
				category: "ci",
			}),
		);
	}
	if (/\[tool\.black\b/.test(text)) {
		out.push(
			rule({
				text: "Run black before committing Python — `[tool.black]` is configured.",
				source: "pyproject.toml",
				sourceKind: "pyproject.toml",
				confidence: 0.8,
				category: "style",
			}),
		);
	}
	if (/\[tool\.mypy\b/.test(text)) {
		out.push(
			rule({
				text: "Run mypy before committing Python — `[tool.mypy]` is configured.",
				source: "pyproject.toml",
				sourceKind: "pyproject.toml",
				confidence: 0.8,
				category: "ci",
			}),
		);
	}
	if (/\[tool\.pytest\b/.test(text) || /pytest/i.test(text)) {
		out.push(
			rule({
				text: "Use pytest for Python tests.",
				source: "pyproject.toml",
				sourceKind: "pyproject.toml",
				confidence: 0.7,
				category: "testing",
			}),
		);
	}
	return out;
}

// ── Cargo.toml ───────────────────────────────────────────────────────────────

function scanCargo(cwd: string): Rule[] {
	if (!existsSync(join(cwd, "Cargo.toml"))) return [];
	const text = safeReadText(join(cwd, "Cargo.toml"));
	const out: Rule[] = [
		rule({
			text: "Run `cargo clippy` and `cargo fmt` before commit.",
			source: "Cargo.toml",
			sourceKind: "Cargo.toml",
			confidence: 0.7,
			category: "ci",
		}),
	];
	if (text && /\[lints\.clippy\]|\[lints\.rust\]/.test(text)) {
		out.push(
			rule({
				text: "Clippy lint rules are enforced via [lints] — do not `#[allow]` without justification.",
				source: "Cargo.toml",
				sourceKind: "Cargo.toml",
				confidence: 0.8,
				category: "style",
			}),
		);
	}
	return out;
}

// ── go.mod ───────────────────────────────────────────────────────────────────

function scanGoMod(cwd: string): Rule[] {
	if (!existsSync(join(cwd, "go.mod"))) return [];
	return [
		rule({
			text: "Run `go vet ./...` and `gofmt -w .` before commit.",
			source: "go.mod",
			sourceKind: "go.mod",
			confidence: 0.7,
			category: "ci",
		}),
	];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rule(r: {
	text: string;
	source: string;
	sourceKind: RuleSourceKind;
	confidence: number;
	category: RuleCategory;
}): Rule {
	return {
		text: r.text,
		source: r.source,
		sourceKind: r.sourceKind,
		confidence: r.confidence,
		category: r.category,
	};
}

function isActive(val: unknown): boolean {
	if (val === undefined || val === null) return false;
	if (val === "off" || val === 0) return false;
	if (Array.isArray(val)) {
		const sev = val[0];
		return sev !== "off" && sev !== 0;
	}
	return true;
}

function safeReadJson(path: string): Record<string, unknown> | null {
	try {
		const raw = readFileSync(path, "utf-8");
		// Strip JSONC line comments (best-effort — Biome allows `.jsonc`).
		const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
		return JSON.parse(stripped) as Record<string, unknown>;
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

/**
 * List every lint/config file we would scan. Used by the orchestrator for
 * logging and by `scan/index.ts` to surface detected files back to the
 * wizard. Ordering is deterministic.
 */
export function listLintConfigFiles(cwd: string): string[] {
	const candidates = [
		"biome.json",
		"biome.jsonc",
		".eslintrc",
		".eslintrc.json",
		".eslintrc.js",
		".eslintrc.cjs",
		".eslintrc.yml",
		".eslintrc.yaml",
		"eslint.config.js",
		"eslint.config.mjs",
		"eslint.config.cjs",
		".prettierrc",
		".prettierrc.json",
		".prettierrc.js",
		".prettierrc.yml",
		".prettierrc.yaml",
		"prettier.config.js",
		"prettier.config.mjs",
		"tsconfig.json",
		"pyproject.toml",
		// NOTE: `ruff.toml` intentionally omitted — we only emit a Ruff rule
		// from `[tool.ruff]` inside `pyproject.toml` today. Including it here
		// would falsely advertise coverage. Re-add once `scanRuffToml` exists.
		"Cargo.toml",
		"go.mod",
	];
	const found: string[] = [];
	for (const c of candidates) {
		if (existsSync(join(cwd, c))) found.push(c);
	}
	return found;
}

// Lightweight re-export for the orchestrator — avoids callers needing to
// read the directory themselves.
export function listGitHubWorkflows(cwd: string): string[] {
	const dir = join(cwd, ".github", "workflows");
	if (!existsSync(dir)) return [];
	try {
		return readdirSync(dir)
			.filter((e) => e.endsWith(".yml") || e.endsWith(".yaml"))
			.sort();
	} catch {
		return [];
	}
}
