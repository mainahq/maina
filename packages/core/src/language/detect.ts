/**
 * Language Detection — detects project languages from marker files.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageId } from "./profile";

const LANGUAGE_MARKERS: Record<LanguageId, string[]> = {
	typescript: ["tsconfig.json", "tsconfig.build.json"],
	python: [
		"pyproject.toml",
		"setup.py",
		"setup.cfg",
		"requirements.txt",
		"Pipfile",
	],
	go: ["go.mod", "go.sum"],
	rust: ["Cargo.toml", "Cargo.lock"],
};

/**
 * Detect languages present in a project directory by checking for marker files.
 * Returns an array of detected LanguageIds.
 * Also detects TypeScript from package.json "typescript" dependency.
 */
export function detectLanguages(cwd: string): LanguageId[] {
	const detected: LanguageId[] = [];

	for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS) as [
		LanguageId,
		string[],
	][]) {
		for (const marker of markers) {
			if (existsSync(join(cwd, marker))) {
				detected.push(lang);
				break;
			}
		}
	}

	// Also check package.json for TypeScript dependency
	if (!detected.includes("typescript")) {
		const pkgPath = join(cwd, "package.json");
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
				const allDeps = {
					...pkg.dependencies,
					...pkg.devDependencies,
				};
				if (allDeps?.typescript) {
					detected.push("typescript");
				}
			} catch {
				// Malformed package.json — skip
			}
		}
	}

	return detected;
}

/**
 * Get the primary (first detected) language, or "typescript" as fallback.
 */
export function getPrimaryLanguage(cwd: string): LanguageId {
	const languages = detectLanguages(cwd);
	return languages[0] ?? "typescript";
}
