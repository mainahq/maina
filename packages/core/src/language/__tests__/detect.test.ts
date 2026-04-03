import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectLanguages } from "../detect";

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
});
