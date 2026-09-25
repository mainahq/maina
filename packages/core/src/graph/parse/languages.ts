/**
 * Language table for the parser layer: which grammar reads which file, where
 * each grammar's WebAssembly build lives, and each language's test-file
 * convention. Defined once here; nothing else hard-codes extensions.
 */

import type { Lang } from "./types";

const EXTENSIONS: Readonly<Record<string, Lang>> = {
	".ts": "typescript",
	".mts": "typescript",
	".cts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".jsx": "javascript",
	".py": "python",
	".pyi": "python",
	".go": "go",
	".rs": "rust",
	".java": "java",
};

/** Grammar file names inside `@vscode/tree-sitter-wasm/wasm/`. */
export const GRAMMAR_FILES: Readonly<Record<Lang, string>> = {
	typescript: "tree-sitter-typescript.wasm",
	tsx: "tree-sitter-tsx.wasm",
	javascript: "tree-sitter-javascript.wasm",
	python: "tree-sitter-python.wasm",
	go: "tree-sitter-go.wasm",
	rust: "tree-sitter-rust.wasm",
	java: "tree-sitter-java.wasm",
};

const segments = (path: string): readonly string[] =>
	path.replace(/\\/g, "/").split("/");

const baseName = (path: string): string => segments(path).at(-1) ?? "";

/** The grammar for a file, by extension; null when no grammar reads it. */
export function detectLang(path: string): Lang | null {
	const name = baseName(path);
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return null;
	return EXTENSIONS[name.slice(dot).toLowerCase()] ?? null;
}

/** True when the path follows the language's test-file convention. */
export function isTestPath(path: string, lang: Lang): boolean {
	const parts = segments(path);
	const name = parts.at(-1) ?? "";
	const dirs = parts.slice(0, -1);
	switch (lang) {
		case "typescript":
		case "tsx":
		case "javascript":
			return (
				/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name) ||
				dirs.includes("__tests__")
			);
		case "python":
			return /^test_.*\.pyi?$/.test(name) || /_test\.pyi?$/.test(name);
		case "go":
			return name.endsWith("_test.go");
		case "rust":
			return dirs.includes("tests") || name.endsWith("_test.rs");
		case "java":
			return (
				/(?:Test|Tests|IT)\.java$/.test(name) ||
				/^Test[A-Z]\w*\.java$/.test(name) ||
				parts.join("/").includes("src/test/")
			);
		default: {
			const unreachable: never = lang;
			return unreachable;
		}
	}
}
