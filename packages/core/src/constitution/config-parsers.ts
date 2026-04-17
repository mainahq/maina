/**
 * Config Parsers — extract constitution rules from lint configs and manifests.
 *
 * Each parser reads a config file and emits ConstitutionRule[] with confidence scores.
 * Confidence 1.0 = explicitly configured, 0.6 = inferred from defaults.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConstitutionRule } from "./git-analyzer";

/**
 * Parse biome.json for lint and formatter rules.
 */
export function parseBiomeConfig(repoRoot: string): ConstitutionRule[] {
	const rules: ConstitutionRule[] = [];
	const filePath = join(repoRoot, "biome.json");
	if (!existsSync(filePath)) return rules;

	try {
		const config = JSON.parse(readFileSync(filePath, "utf-8"));

		rules.push({
			text: "Linter: Biome",
			confidence: 1.0,
			source: "biome.json",
		});

		if (config.formatter?.indentStyle) {
			rules.push({
				text: `Indent style: ${config.formatter.indentStyle}`,
				confidence: 1.0,
				source: "biome.json (formatter.indentStyle)",
			});
		}

		if (config.formatter?.lineWidth) {
			rules.push({
				text: `Line width: ${config.formatter.lineWidth}`,
				confidence: 1.0,
				source: "biome.json (formatter.lineWidth)",
			});
		}

		if (config.linter?.rules?.recommended) {
			rules.push({
				text: "Biome recommended lint rules enabled",
				confidence: 1.0,
				source: "biome.json (linter.rules.recommended)",
			});
		}
	} catch {
		// Parse error — skip
	}

	return rules;
}

/**
 * Parse ESLint config files (.eslintrc*, eslint.config.*).
 */
export function parseEslintConfig(repoRoot: string): ConstitutionRule[] {
	const rules: ConstitutionRule[] = [];
	const candidates = [
		".eslintrc.json",
		".eslintrc.js",
		".eslintrc.yml",
		".eslintrc.yaml",
		".eslintrc",
		"eslint.config.js",
		"eslint.config.mjs",
		"eslint.config.ts",
	];

	for (const candidate of candidates) {
		if (existsSync(join(repoRoot, candidate))) {
			rules.push({
				text: `Linter: ESLint (config: ${candidate})`,
				confidence: 1.0,
				source: candidate,
			});
			break;
		}
	}

	return rules;
}

/**
 * Parse tsconfig.json for TypeScript settings.
 */
export function parseTsConfig(repoRoot: string): ConstitutionRule[] {
	const rules: ConstitutionRule[] = [];
	const filePath = join(repoRoot, "tsconfig.json");
	if (!existsSync(filePath)) return rules;

	try {
		const content = readFileSync(filePath, "utf-8");
		// Simple regex parsing — tsconfig may have comments
		if (/"strict"\s*:\s*true/.test(content)) {
			rules.push({
				text: "TypeScript strict mode enabled",
				confidence: 1.0,
				source: "tsconfig.json (strict: true)",
			});
		}

		const targetMatch = content.match(/"target"\s*:\s*"([^"]+)"/);
		if (targetMatch?.[1]) {
			rules.push({
				text: `TypeScript target: ${targetMatch[1]}`,
				confidence: 1.0,
				source: "tsconfig.json (target)",
			});
		}

		if (/"paths"/.test(content)) {
			rules.push({
				text: "TypeScript path aliases configured",
				confidence: 0.6,
				source: "tsconfig.json (paths)",
			});
		}
	} catch {
		// Parse error — skip
	}

	return rules;
}

/**
 * Parse .editorconfig for editor settings.
 */
export function parseEditorConfig(repoRoot: string): ConstitutionRule[] {
	const rules: ConstitutionRule[] = [];
	const filePath = join(repoRoot, ".editorconfig");
	if (!existsSync(filePath)) return rules;

	try {
		const content = readFileSync(filePath, "utf-8");

		const indentStyle = content.match(/indent_style\s*=\s*(\w+)/);
		if (indentStyle?.[1]) {
			rules.push({
				text: `Editor indent style: ${indentStyle[1]}`,
				confidence: 1.0,
				source: ".editorconfig (indent_style)",
			});
		}

		const indentSize = content.match(/indent_size\s*=\s*(\w+)/);
		if (indentSize?.[1]) {
			rules.push({
				text: `Editor indent size: ${indentSize[1]}`,
				confidence: 1.0,
				source: ".editorconfig (indent_size)",
			});
		}

		const charset = content.match(/charset\s*=\s*(\S+)/);
		if (charset?.[1]) {
			rules.push({
				text: `Charset: ${charset[1]}`,
				confidence: 1.0,
				source: ".editorconfig (charset)",
			});
		}
	} catch {
		// Read error — skip
	}

	return rules;
}

/**
 * Parse package.json for scripts, engines, and module type.
 */
export function parsePackageJson(repoRoot: string): ConstitutionRule[] {
	const rules: ConstitutionRule[] = [];
	const filePath = join(repoRoot, "package.json");
	if (!existsSync(filePath)) return rules;

	try {
		const pkg = JSON.parse(readFileSync(filePath, "utf-8"));

		if (pkg.type === "module") {
			rules.push({
				text: "ESM modules (type: module)",
				confidence: 1.0,
				source: "package.json (type)",
			});
		}

		if (pkg.engines?.node) {
			rules.push({
				text: `Node.js engine requirement: ${pkg.engines.node}`,
				confidence: 1.0,
				source: "package.json (engines.node)",
			});
		}

		if (pkg.engines?.bun) {
			rules.push({
				text: `Bun engine requirement: ${pkg.engines.bun}`,
				confidence: 1.0,
				source: "package.json (engines.bun)",
			});
		}

		// Extract key scripts
		if (pkg.scripts) {
			const keyScripts = ["test", "lint", "build", "typecheck", "check"];
			for (const name of keyScripts) {
				if (pkg.scripts[name]) {
					rules.push({
						text: `Script '${name}': \`${pkg.scripts[name]}\``,
						confidence: 1.0,
						source: `package.json (scripts.${name})`,
					});
				}
			}
		}
	} catch {
		// Parse error — skip
	}

	return rules;
}

/**
 * Parse .prettierrc* for Prettier config.
 */
export function parsePrettierConfig(repoRoot: string): ConstitutionRule[] {
	const candidates = [
		".prettierrc",
		".prettierrc.json",
		".prettierrc.yml",
		".prettierrc.yaml",
		".prettierrc.js",
		"prettier.config.js",
		"prettier.config.mjs",
	];

	for (const candidate of candidates) {
		if (existsSync(join(repoRoot, candidate))) {
			return [
				{
					text: `Formatter: Prettier (config: ${candidate})`,
					confidence: 1.0,
					source: candidate,
				},
			];
		}
	}

	return [];
}

/**
 * Run all config parsers and return combined rules.
 */
export function parseAllConfigs(repoRoot: string): ConstitutionRule[] {
	return [
		...parseBiomeConfig(repoRoot),
		...parseEslintConfig(repoRoot),
		...parseTsConfig(repoRoot),
		...parseEditorConfig(repoRoot),
		...parsePrettierConfig(repoRoot),
		...parsePackageJson(repoRoot),
	];
}
