/**
 * Language Profiles — maps each supported language to its tools,
 * file patterns, and slop detection rules.
 */

export type LanguageId =
	| "typescript"
	| "python"
	| "go"
	| "rust"
	| "csharp"
	| "java";

export interface LanguageProfile {
	id: LanguageId;
	displayName: string;
	extensions: string[];
	syntaxTool: string;
	syntaxArgs: (files: string[], cwd: string) => string[];
	commentPrefixes: string[];
	testFilePattern: RegExp;
	printPattern: RegExp;
	lintIgnorePattern: RegExp;
	importPattern: RegExp;
	fileGlobs: string[];
}

export const TYPESCRIPT_PROFILE: LanguageProfile = {
	id: "typescript",
	displayName: "TypeScript",
	extensions: [".ts", ".tsx", ".js", ".jsx"],
	syntaxTool: "biome",
	syntaxArgs: (files, _cwd) => [
		"biome",
		"check",
		"--reporter=json",
		"--no-errors-on-unmatched",
		"--colors=off",
		...files,
	],
	commentPrefixes: ["//", "/*"],
	testFilePattern: /\.(test|spec)\.[jt]sx?$/,
	printPattern: /console\.(log|warn|error|debug|info)\s*\(/,
	lintIgnorePattern: /@ts-ignore|@ts-expect-error|noinspection/,
	importPattern:
		/^import\s+(?:type\s+)?(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+["']([^"']+)["']/,
	fileGlobs: ["*.ts", "*.tsx", "*.js", "*.jsx"],
};

export const PYTHON_PROFILE: LanguageProfile = {
	id: "python",
	displayName: "Python",
	extensions: [".py", ".pyi"],
	syntaxTool: "ruff",
	syntaxArgs: (files, _cwd) => [
		"ruff",
		"check",
		"--output-format=json",
		...files,
	],
	commentPrefixes: ["#"],
	testFilePattern: /(?:^test_|_test\.py$|tests\/)/,
	printPattern: /\bprint\s*\(/,
	lintIgnorePattern: /# type:\s*ignore|# noqa|# pragma:\s*no cover/,
	importPattern: /^(?:from\s+(\S+)\s+import|import\s+(\S+))/,
	fileGlobs: ["*.py", "*.pyi"],
};

export const GO_PROFILE: LanguageProfile = {
	id: "go",
	displayName: "Go",
	extensions: [".go"],
	syntaxTool: "go-vet",
	syntaxArgs: (files, _cwd) => ["go", "vet", ...files],
	commentPrefixes: ["//"],
	testFilePattern: /_test\.go$/,
	printPattern: /fmt\.Print(?:ln|f)?\s*\(/,
	lintIgnorePattern: /\/\/\s*nolint/,
	importPattern: /^\s*"([^"]+)"/,
	fileGlobs: ["*.go"],
};

export const RUST_PROFILE: LanguageProfile = {
	id: "rust",
	displayName: "Rust",
	extensions: [".rs"],
	syntaxTool: "clippy",
	syntaxArgs: (files, _cwd) => [
		"cargo",
		"clippy",
		"--message-format=json",
		"--",
		...files,
	],
	commentPrefixes: ["//"],
	testFilePattern: /(?:tests\/|_test\.rs$|#\[cfg\(test\)\])/,
	printPattern: /(?:println!|print!|eprintln!|eprint!)\s*\(/,
	lintIgnorePattern: /#\[allow\(|#!\[allow\(/,
	importPattern: /^use\s+(\S+)/,
	fileGlobs: ["*.rs"],
};

export const CSHARP_PROFILE: LanguageProfile = {
	id: "csharp",
	displayName: "C#",
	extensions: [".cs"],
	syntaxTool: "dotnet-format",
	syntaxArgs: (files, _cwd) => [
		"dotnet",
		"format",
		"--verify-no-changes",
		"--include",
		...files,
	],
	commentPrefixes: ["//", "/*"],
	testFilePattern: /(?:Tests?\.cs$|\.Tests?\.|tests\/)/,
	printPattern: /Console\.Write(?:Line)?\s*\(/,
	lintIgnorePattern:
		/#pragma\s+warning\s+disable|\/\/\s*noinspection|\[SuppressMessage/,
	importPattern: /^using\s+(\S+)/,
	fileGlobs: ["*.cs"],
};

export const JAVA_PROFILE: LanguageProfile = {
	id: "java",
	displayName: "Java",
	extensions: [".java", ".kt"],
	syntaxTool: "checkstyle",
	syntaxArgs: (files, _cwd) => ["checkstyle", "-f", "xml", ...files],
	commentPrefixes: ["//", "/*"],
	testFilePattern: /(?:Test\.java$|Spec\.java$|src\/test\/)/,
	printPattern: /System\.out\.print(?:ln)?\s*\(/,
	lintIgnorePattern: /@SuppressWarnings|\/\/\s*NOPMD|\/\/\s*NOSONAR/,
	importPattern: /^import\s+(\S+)/,
	fileGlobs: ["*.java", "*.kt"],
};

const PROFILES: Record<LanguageId, LanguageProfile> = {
	typescript: TYPESCRIPT_PROFILE,
	python: PYTHON_PROFILE,
	go: GO_PROFILE,
	rust: RUST_PROFILE,
	csharp: CSHARP_PROFILE,
	java: JAVA_PROFILE,
};

export function getProfile(id: LanguageId): LanguageProfile {
	return PROFILES[id];
}

export function getSupportedLanguages(): LanguageId[] {
	return Object.keys(PROFILES) as LanguageId[];
}
