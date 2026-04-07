import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrap } from "../index";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-detect-stack-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("detectStack — languages field", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("empty directory returns languages with 'unknown'", async () => {
		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toBeDefined();
			expect(Array.isArray(result.value.detectedStack.languages)).toBe(true);
			expect(result.value.detectedStack.languages).toContain("unknown");
		}
	});

	test("TypeScript project includes 'typescript' in languages", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { typescript: "^5.0.0" } }),
		);
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("typescript");
			expect(result.value.detectedStack.languages).not.toContain("unknown");
		}
	});

	test("JavaScript project includes 'javascript' in languages", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ dependencies: { express: "^4.0.0" } }),
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("javascript");
			expect(result.value.detectedStack.languages).not.toContain("unknown");
		}
	});

	test("go.mod detected as 'go' language", async () => {
		writeFileSync(
			join(tmpDir, "go.mod"),
			"module example.com/foo\n\ngo 1.21\n",
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("go");
		}
	});

	test("Cargo.toml detected as 'rust' language", async () => {
		writeFileSync(
			join(tmpDir, "Cargo.toml"),
			'[package]\nname = "test"\nversion = "0.1.0"\n',
		);

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("rust");
		}
	});

	test("pyproject.toml detected as 'python' language", async () => {
		writeFileSync(join(tmpDir, "pyproject.toml"), "[project]\nname = 'test'\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("python");
		}
	});

	test("requirements.txt detected as 'python' language", async () => {
		writeFileSync(join(tmpDir, "requirements.txt"), "flask==2.0.0\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("python");
		}
	});

	test("setup.py detected as 'python' language", async () => {
		writeFileSync(join(tmpDir, "setup.py"), "from setuptools import setup\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("python");
		}
	});

	test("pom.xml detected as 'java' language", async () => {
		writeFileSync(join(tmpDir, "pom.xml"), "<project></project>\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("java");
		}
	});

	test("build.gradle detected as 'java' language", async () => {
		writeFileSync(join(tmpDir, "build.gradle"), "apply plugin: 'java'\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("java");
		}
	});

	test("build.gradle.kts detected as 'java' language", async () => {
		writeFileSync(join(tmpDir, "build.gradle.kts"), 'plugins { id("java") }\n');

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("java");
		}
	});

	test(".csproj file detected as 'dotnet' language", async () => {
		writeFileSync(join(tmpDir, "MyApp.csproj"), "<Project></Project>\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("dotnet");
		}
	});

	test(".sln file detected as 'dotnet' language", async () => {
		writeFileSync(join(tmpDir, "MyApp.sln"), "Microsoft Visual Studio\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("dotnet");
		}
	});

	test(".fsproj file detected as 'dotnet' language", async () => {
		writeFileSync(join(tmpDir, "MyApp.fsproj"), "<Project></Project>\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("dotnet");
		}
	});

	test("multi-language project detects all languages", async () => {
		// TypeScript + Python
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { typescript: "^5.0.0" } }),
		);
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}");
		writeFileSync(join(tmpDir, "requirements.txt"), "flask==2.0.0\n");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.detectedStack.languages).toContain("typescript");
			expect(result.value.detectedStack.languages).toContain("python");
			expect(
				result.value.detectedStack.languages.length,
			).toBeGreaterThanOrEqual(2);
		}
	});

	test("TypeScript + Go + Rust multi-language detection", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { typescript: "^5.0.0" } }),
		);
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}");
		writeFileSync(join(tmpDir, "go.mod"), "module test\n\ngo 1.21\n");
		writeFileSync(join(tmpDir, "Cargo.toml"), '[package]\nname = "test"\n');

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const langs = result.value.detectedStack.languages;
			expect(langs).toContain("typescript");
			expect(langs).toContain("go");
			expect(langs).toContain("rust");
			expect(langs.length).toBeGreaterThanOrEqual(3);
		}
	});

	test("languages does not contain duplicates", async () => {
		writeFileSync(
			join(tmpDir, "package.json"),
			JSON.stringify({ devDependencies: { typescript: "^5.0.0" } }),
		);
		writeFileSync(join(tmpDir, "tsconfig.json"), "{}");

		const result = await bootstrap(tmpDir);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const langs = result.value.detectedStack.languages;
			const unique = [...new Set(langs)];
			expect(langs.length).toBe(unique.length);
		}
	});
});
