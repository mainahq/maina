import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectFileLanguage, detectLanguages } from "../detect";

describe("detectLanguages", () => {
	const testDir = join(import.meta.dir, "__fixtures__/detect");

	function setup(files: Record<string, string>) {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
		mkdirSync(testDir, { recursive: true });
		for (const [name, content] of Object.entries(files)) {
			writeFileSync(join(testDir, name), content);
		}
	}

	function cleanup() {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	}

	it("should detect TypeScript from tsconfig.json", () => {
		setup({ "tsconfig.json": "{}" });
		const result = detectLanguages(testDir);
		expect(result).toContain("typescript");
		cleanup();
	});

	it("should detect Python from pyproject.toml", () => {
		setup({ "pyproject.toml": "[tool.ruff]" });
		const result = detectLanguages(testDir);
		expect(result).toContain("python");
		cleanup();
	});

	it("should detect Go from go.mod", () => {
		setup({ "go.mod": "module example.com/foo" });
		const result = detectLanguages(testDir);
		expect(result).toContain("go");
		cleanup();
	});

	it("should detect Rust from Cargo.toml", () => {
		setup({ "Cargo.toml": '[package]\nname = "test"' });
		const result = detectLanguages(testDir);
		expect(result).toContain("rust");
		cleanup();
	});

	it("should detect multiple languages in polyglot repo", () => {
		setup({ "tsconfig.json": "{}", "pyproject.toml": "" });
		const result = detectLanguages(testDir);
		expect(result).toContain("typescript");
		expect(result).toContain("python");
		cleanup();
	});

	it("should return empty array for unknown project", () => {
		setup({ "README.md": "hello" });
		const result = detectLanguages(testDir);
		expect(result).toHaveLength(0);
		cleanup();
	});

	it("should detect Python from requirements.txt", () => {
		setup({ "requirements.txt": "flask==2.0" });
		const result = detectLanguages(testDir);
		expect(result).toContain("python");
		cleanup();
	});

	it("should detect Python from setup.py", () => {
		setup({ "setup.py": "from setuptools import setup" });
		const result = detectLanguages(testDir);
		expect(result).toContain("python");
		cleanup();
	});

	it("should detect PHP from composer.json", () => {
		setup({ "composer.json": '{"require": {"php": ">=8.1"}}' });
		const result = detectLanguages(testDir);
		expect(result).toContain("php");
		cleanup();
	});

	it("should detect PHP from composer.lock", () => {
		setup({ "composer.lock": '{"packages": []}' });
		const result = detectLanguages(testDir);
		expect(result).toContain("php");
		cleanup();
	});
});

describe("detectFileLanguage", () => {
	it("should detect TypeScript from .ts extension", () => {
		expect(detectFileLanguage("src/index.ts")).toBe("typescript");
	});

	it("should detect TypeScript from .tsx extension", () => {
		expect(detectFileLanguage("components/App.tsx")).toBe("typescript");
	});

	it("should detect Python from .py extension", () => {
		expect(detectFileLanguage("app/main.py")).toBe("python");
	});

	it("should detect Go from .go extension", () => {
		expect(detectFileLanguage("cmd/server.go")).toBe("go");
	});

	it("should detect Rust from .rs extension", () => {
		expect(detectFileLanguage("src/lib.rs")).toBe("rust");
	});

	it("should detect C# from .cs extension", () => {
		expect(detectFileLanguage("Controllers/HomeController.cs")).toBe("csharp");
	});

	it("should detect Java from .java extension", () => {
		expect(detectFileLanguage("src/Main.java")).toBe("java");
	});

	it("should detect PHP from .php extension", () => {
		expect(detectFileLanguage("src/Controller.php")).toBe("php");
	});

	it("should return null for unknown extensions", () => {
		expect(detectFileLanguage("data.csv")).toBeNull();
		expect(detectFileLanguage("README.md")).toBeNull();
		expect(detectFileLanguage("Dockerfile")).toBeNull();
	});

	it("should handle case-insensitive extensions", () => {
		expect(detectFileLanguage("script.PY")).toBe("python");
		expect(detectFileLanguage("main.Go")).toBe("go");
		expect(detectFileLanguage("index.PHP")).toBe("php");
	});
});
