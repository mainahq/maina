/**
 * Language Detection — detects project languages from marker files.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { type LanguageId, PROFILES } from "./profile";

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
	csharp: ["global.json", "Directory.Build.props"],
	java: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle"],
	php: ["composer.json", "composer.lock"],
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

	// C# — check for .sln or .csproj files (names vary)
	if (!detected.includes("csharp")) {
		try {
			const entries = readdirSync(cwd);
			if (
				entries.some((e: string) => e.endsWith(".sln") || e.endsWith(".csproj"))
			) {
				detected.push("csharp");
			}
		} catch {}
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

/**
 * Detect language for a single file based on its extension.
 * Returns the LanguageId if matched, or null if unknown.
 */
export function detectFileLanguage(filePath: string): LanguageId | null {
	const ext = extname(filePath).toLowerCase();
	if (!ext) return null;
	for (const profile of Object.values(PROFILES)) {
		if (profile.extensions.includes(ext)) {
			return profile.id;
		}
	}
	return null;
}
