import { describe, expect, it } from "bun:test";
import { getProfile, TYPESCRIPT_PROFILE } from "../profile";

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
});
