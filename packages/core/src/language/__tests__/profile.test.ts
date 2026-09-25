import { describe, expect, it } from "bun:test";
import {
	getProfile,
	getSupportedLanguages,
	isCodeFile,
	TYPESCRIPT_PROFILE,
} from "../profile";

describe("LanguageProfile", () => {
	it("should return TypeScript profile by default", () => {
		const profile = getProfile("typescript");
		expect(profile.id).toBe("typescript");
		expect(profile.extensions).toContain(".ts");
		expect(profile.extensions).toContain(".tsx");
		expect(profile.syntaxTool).toBe("biome");
		expect(profile.commentPrefixes).toContain("//");
	});

	it("should return Python profile", () => {
		const profile = getProfile("python");
		expect(profile.id).toBe("python");
		expect(profile.extensions).toContain(".py");
		expect(profile.syntaxTool).toBe("ruff");
		expect(profile.commentPrefixes).toContain("#");
	});

	it("should return Go profile", () => {
		const profile = getProfile("go");
		expect(profile.id).toBe("go");
		expect(profile.extensions).toContain(".go");
		expect(profile.syntaxTool).toBe("go-vet");
		expect(profile.commentPrefixes).toContain("//");
	});

	it("should return Rust profile", () => {
		const profile = getProfile("rust");
		expect(profile.id).toBe("rust");
		expect(profile.extensions).toContain(".rs");
		expect(profile.syntaxTool).toBe("clippy");
		expect(profile.commentPrefixes).toContain("//");
	});

	it("should return C# profile", () => {
		const profile = getProfile("csharp");
		expect(profile.id).toBe("csharp");
		expect(profile.extensions).toContain(".cs");
		expect(profile.syntaxTool).toBe("dotnet-format");
	});

	it("should return Java profile", () => {
		const profile = getProfile("java");
		expect(profile.id).toBe("java");
		expect(profile.extensions).toContain(".java");
		expect(profile.extensions).toContain(".kt");
		expect(profile.syntaxTool).toBe("checkstyle");
	});

	it("should have test file pattern for each language", () => {
		expect(TYPESCRIPT_PROFILE.testFilePattern.test("app.test.ts")).toBe(true);
		expect(getProfile("python").testFilePattern.test("test_app.py")).toBe(true);
		expect(getProfile("go").testFilePattern.test("app_test.go")).toBe(true);
		expect(getProfile("rust").testFilePattern.test("tests/mod.rs")).toBe(true);
	});

	it("should have console/print patterns for slop detection", () => {
		expect(TYPESCRIPT_PROFILE.printPattern.test("console.log('x')")).toBe(true);
		expect(getProfile("python").printPattern.test("print('x')")).toBe(true);
		expect(getProfile("go").printPattern.test("fmt.Println(x)")).toBe(true);
		expect(getProfile("rust").printPattern.test("println!(x)")).toBe(true);
	});

	it("should return PHP profile", () => {
		const profile = getProfile("php");
		expect(profile.id).toBe("php");
		expect(profile.displayName).toBe("PHP");
		expect(profile.extensions).toContain(".php");
		expect(profile.syntaxTool).toBe("phpstan");
		expect(profile.commentPrefixes).toContain("//");
		expect(profile.commentPrefixes).toContain("#");
		expect(profile.commentPrefixes).toContain("/*");
	});

	it("should have PHP test file pattern", () => {
		const profile = getProfile("php");
		expect(profile.testFilePattern.test("UserTest.php")).toBe(true);
		expect(profile.testFilePattern.test("tests/UserTest.php")).toBe(true);
		expect(profile.testFilePattern.test("src/User.php")).toBe(false);
	});

	it("should have PHP print/debug patterns", () => {
		const profile = getProfile("php");
		expect(profile.printPattern.test("echo('hello')")).toBe(true);
		expect(profile.printPattern.test("print('hello')")).toBe(true);
		expect(profile.printPattern.test("var_dump($x)")).toBe(true);
		expect(profile.printPattern.test("print_r($arr)")).toBe(true);
		expect(profile.printPattern.test("error_log('msg')")).toBe(true);
	});

	it("should have PHP lint ignore patterns", () => {
		const profile = getProfile("php");
		expect(profile.lintIgnorePattern.test("@phpstan-ignore")).toBe(true);
		expect(profile.lintIgnorePattern.test("@psalm-suppress")).toBe(true);
		expect(profile.lintIgnorePattern.test("phpcs:ignore")).toBe(true);
	});

	it("should have PHP import pattern", () => {
		const profile = getProfile("php");
		expect(profile.importPattern.test("use App\\Models\\User;")).toBe(true);
		expect(profile.importPattern.test("require 'vendor/autoload.php';")).toBe(
			true,
		);
		expect(profile.importPattern.test("include 'config.php';")).toBe(true);
	});

	it("should include php in supported languages", () => {
		const languages = getSupportedLanguages();
		expect(languages).toContain("php");
	});
});

describe("isCodeFile (#372)", () => {
	it("accepts JS/TS module extensions", () => {
		for (const f of [
			"a.ts",
			"a.tsx",
			"a.js",
			"a.jsx",
			"a.mjs",
			"a.cjs",
			"a.mts",
			"a.cts",
		]) {
			expect(isCodeFile(f)).toBe(true);
		}
	});

	it("accepts component formats that hold script code", () => {
		for (const f of ["App.vue", "Button.svelte", "pages/index.astro"]) {
			expect(isCodeFile(f)).toBe(true);
		}
	});

	it("accepts every language-profile extension", () => {
		for (const id of getSupportedLanguages()) {
			for (const ext of getProfile(id).extensions) {
				expect(isCodeFile(`src/file${ext}`)).toBe(true);
			}
		}
	});

	it("rejects data and docs files", () => {
		for (const f of [
			"fixtures/case.json",
			"corpus/cases.jsonl",
			".github/workflows/ci.yml",
			"config.yaml",
			"README.md",
			"notes.txt",
			"Makefile",
			"dir.ts/data.json",
		]) {
			expect(isCodeFile(f)).toBe(false);
		}
	});

	it("is case-insensitive on the extension", () => {
		expect(isCodeFile("LEGACY.JS")).toBe(true);
		expect(isCodeFile("DATA.JSON")).toBe(false);
	});
});
