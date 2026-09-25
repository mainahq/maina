/**
 * Tests for built-in verify checks.
 *
 * Each check is a pure function: (filePath, content) => Finding[].
 * No I/O, no side effects — just string analysis.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	checkAnyType,
	checkConsoleLogs,
	checkEmptyCatch,
	checkFileSize,
	checkSecrets,
	checkTodoComments,
	checkUnusedImports,
	runBuiltinChecks,
} from "../builtin";

// ─── checkConsoleLogs ────────────────────────────────────────────────────

describe("checkConsoleLogs", () => {
	it("detects console.log in a .ts file", () => {
		const content = `const x = 1;\nconsole.log(x);\nconst y = 2;\n`;
		const findings = checkConsoleLogs("src/app.ts", content);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.line).toBe(2);
		expect(findings[0]?.severity).toBe("warning");
		expect(findings[0]?.ruleId).toBe("no-console-log");
		expect(findings[0]?.tool).toBe("builtin");
		expect(findings[0]?.file).toBe("src/app.ts");
	});

	it("skips .test.ts files", () => {
		const content = `console.log("debug");\n`;
		const findings = checkConsoleLogs("src/app.test.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("skips .spec.ts files", () => {
		const content = `console.log("debug");\n`;
		const findings = checkConsoleLogs("src/app.spec.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("skips files in __tests__ directories", () => {
		const content = `console.log("debug");\n`;
		const findings = checkConsoleLogs("src/__tests__/app.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("detects console.warn and console.error too", () => {
		const content = `console.warn("w");\nconsole.error("e");\n`;
		const findings = checkConsoleLogs("src/app.ts", content);
		expect(findings).toHaveLength(2);
	});

	it("returns empty for clean files", () => {
		const content = `const x = 1;\nconst y = 2;\n`;
		const findings = checkConsoleLogs("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("skips dev-only repo scripts under scripts/ and ci/ (#380)", () => {
		const content = `console.log("generated");\nconsole.error("failed");\n`;
		for (const file of [
			"scripts/generate-schemas.ts",
			"scripts/dogfood/receipt.ts",
			"./scripts/check-paths.ts",
			"ci/e2e/run.ts",
			"scripts\\generate-schemas.ts",
		]) {
			expect(checkConsoleLogs(file, content)).toEqual([]);
		}
	});

	it("still flags package source whose path merely contains scripts/ or ci/", () => {
		const content = `console.log("x");\n`;
		for (const file of [
			"packages/cli/src/scripts/run.ts",
			"packages/core/src/ci/detect.ts",
			"src/bench/timer.ts",
			"myscripts/tool.ts",
			// Not covered by the Biome noConsole override, so still checked.
			"bench/run.ts",
		]) {
			expect(checkConsoleLogs(file, content)).toHaveLength(1);
		}
	});
});

// ─── checkTodoComments ───────────────────────────────────────────────────

describe("checkTodoComments", () => {
	it("detects TODO with correct line numbers", () => {
		const content = `const x = 1;\n// TODO: fix this\nconst y = 2;\n// FIXME: broken\n`;
		const findings = checkTodoComments("src/app.ts", content);
		expect(findings).toHaveLength(2);
		expect(findings[0]?.line).toBe(2);
		expect(findings[0]?.message).toContain("TODO");
		expect(findings[1]?.line).toBe(4);
		expect(findings[1]?.message).toContain("FIXME");
	});

	it("detects HACK comments", () => {
		const content = `// HACK: temporary workaround\n`;
		const findings = checkTodoComments("src/app.ts", content);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.ruleId).toBe("todo-comment");
	});

	it("returns empty when no markers present", () => {
		const content = `const x = 1;\n// This is a normal comment\n`;
		const findings = checkTodoComments("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});
});

// ─── checkFileSize ───────────────────────────────────────────────────────

describe("checkFileSize", () => {
	it("flags files over 500 lines", () => {
		const lines = Array.from({ length: 501 }, (_, i) => `const x${i} = ${i};`);
		const content = lines.join("\n");
		const findings = checkFileSize("src/big.ts", content);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.severity).toBe("warning");
		expect(findings[0]?.ruleId).toBe("file-too-long");
		expect(findings[0]?.message).toContain("501");
	});

	it("does not flag files with exactly 500 lines", () => {
		const lines = Array.from({ length: 500 }, (_, i) => `const x${i} = ${i};`);
		const content = lines.join("\n");
		const findings = checkFileSize("src/ok.ts", content);
		expect(findings).toHaveLength(0);
	});
});

// ─── checkSecrets ────────────────────────────────────────────────────────

describe("checkSecrets", () => {
	it("detects hardcoded password patterns", () => {
		const content = `const config = {\n  password="s3cret123"\n};\n`;
		const findings = checkSecrets("src/config.ts", content);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.severity).toBe("error");
		expect(findings[0]?.ruleId).toBe("hardcoded-secret");
	});

	it("detects api_key patterns", () => {
		const content = `const api_key = "abc123def456";\n`;
		const findings = checkSecrets("src/config.ts", content);
		expect(findings).toHaveLength(1);
	});

	it("ignores variable references (not hardcoded)", () => {
		const content = `const password = process.env.PASSWORD;\n`;
		const findings = checkSecrets("src/config.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("detects token patterns", () => {
		const content = `const token = "ghp_abc123def456";\n`;
		const findings = checkSecrets("src/config.ts", content);
		expect(findings).toHaveLength(1);
	});

	it("detects secret patterns", () => {
		const content = `secret="mySecretValue123";\n`;
		const findings = checkSecrets("src/config.ts", content);
		expect(findings).toHaveLength(1);
	});

	it("skips test files entirely (#85)", () => {
		const content = `const token = "real-looking-token-abc123";\n`;
		expect(checkSecrets("src/__tests__/auth.test.ts", content)).toHaveLength(0);
		expect(checkSecrets("tests/config.spec.ts", content)).toHaveLength(0);
		expect(checkSecrets("src/auth.test.js", content)).toHaveLength(0);
	});

	it("ignores obvious test fixture values (#85)", () => {
		const content = `apiKey: "test-key-not-real";\n`;
		expect(checkSecrets("src/config.ts", content)).toHaveLength(0);
	});

	it("ignores values starting with test/fake/mock/dummy/placeholder", () => {
		const fixtures = [
			`token = "test-token-abc"`,
			`apikey = "fake-api-key"`,
			`secret = "mock-secret-123"`,
			`password = "dummy-password"`,
			`api_key = "placeholder-key"`,
			`token = "xxx"`,
			`secret = "your-secret-here"`,
		];
		for (const line of fixtures) {
			expect(checkSecrets("src/config.ts", line)).toHaveLength(0);
		}
	});

	it("still flags real-looking secrets in non-test files", () => {
		const content = `const apikey = "sk_live_abc123def456";\n`;
		expect(checkSecrets("src/config.ts", content)).toHaveLength(1);
	});
});

// ─── checkSecrets: JSON / YAML key forms (#391) ──────────────────────────

describe("checkSecrets JSON/YAML key forms (#391)", () => {
	const fixture = (name: string) =>
		readFileSync(join(import.meta.dir, "fixtures", "secrets", name), "utf-8");
	const lines = (findings: { line: number }[]) => findings.map((f) => f.line);

	it('detects quoted JSON keys like "api_key": "..."', () => {
		expect(
			checkSecrets("config/app.json", '{ "api_key": "Zq8vN3pL5tR7wX2yB4cD" }'),
		).toHaveLength(1);
		expect(
			checkSecrets("config/app.json", `{ 'token' : 'a1B2c3D4e5F6g7H8' }`),
		).toHaveLength(1);
	});

	it("detects JSON-style keys inside code files too", () => {
		const content = `const cfg = { "password": "hunter2-Correct-Horse" };\n`;
		expect(checkSecrets("src/config.ts", content)).toHaveLength(1);
	});

	it("detects hyphenated key forms (api-key, auth-token)", () => {
		expect(
			checkSecrets("config/app.json", '"x-api-key": "Zq8vN3pL5tR7wX2yB4cD"'),
		).toHaveLength(1);
		expect(
			checkSecrets("config/app.yml", "auth-token: a1B2c3D4e5F6g7H8"),
		).toHaveLength(1);
	});

	it("detects unquoted YAML values", () => {
		expect(
			checkSecrets("config/app.yaml", "api_key: Zq8vN3pL5tR7wX2yB4cD"),
		).toHaveLength(1);
	});

	it("flags every hardcoded key in the leaky JSON fixture", () => {
		const findings = checkSecrets("config/leaky.json", fixture("leaky.json"));
		expect(lines(findings)).toEqual([3, 5, 6]);
		expect(findings.every((f) => f.ruleId === "hardcoded-secret")).toBe(true);
	});

	it("flags every hardcoded key in the leaky YAML fixture", () => {
		const findings = checkSecrets("config/leaky.yml", fixture("leaky.yml"));
		expect(lines(findings)).toEqual([2, 4, 5, 7]);
	});

	it("does not flag a JSON schema that only names secret keys", () => {
		expect(checkSecrets("schemas/config.json", fixture("schema.json"))).toEqual(
			[],
		);
	});

	it("does not flag a YAML schema that only names secret keys", () => {
		expect(checkSecrets("schemas/config.yml", fixture("schema.yml"))).toEqual(
			[],
		);
	});

	it("does not flag ellipsis placeholders in docs and examples", () => {
		const content = '// e.g. `"api_key": "..."` or `token: "…"`\n';
		expect(checkSecrets("src/docs.ts", content)).toEqual([]);
	});

	it("does not flag i18n labels that echo the key name", () => {
		const content = '{\n\t"password": "Password",\n\t"api_key": "API_KEY"\n}\n';
		expect(checkSecrets("locales/en.json", content)).toEqual([]);
		expect(checkSecrets("locales/en.yml", "token: Token")).toEqual([]);
	});

	it("checks every key on a line, not only the first (minified JSON)", () => {
		const secret = "Zq8vN3pL5tR7wX2yB4cD";
		for (const content of [
			`{"password":"Password","api_key":"${secret}"}`,
			`{"token":"test","secret":"${secret}"}`,
			`{"api_key":"<your-key>","token":"${secret}"}`,
		]) {
			expect(checkSecrets("config/min.json", content)).toHaveLength(1);
		}
		// Still one finding per line even when several keys leak.
		expect(
			checkSecrets(
				"config/min.json",
				`{"token":"${secret}","secret":"${secret}"}`,
			),
		).toHaveLength(1);
	});

	it("does not treat unquoted type annotations in code as YAML values", () => {
		const content = "interface Cfg {\n\tapi_key: string\n\ttoken: Token\n}\n";
		expect(checkSecrets("src/types.ts", content)).toEqual([]);
	});
});

// ─── checkEmptyCatch ─────────────────────────────────────────────────────

describe("checkEmptyCatch", () => {
	it("detects empty catch blocks", () => {
		const content = `try {\n  doSomething();\n} catch (e) {\n}\n`;
		const findings = checkEmptyCatch("src/app.ts", content);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.ruleId).toBe("empty-catch");
		expect(findings[0]?.severity).toBe("warning");
	});

	it("does not flag catch blocks with content", () => {
		const content = `try {\n  doSomething();\n} catch (e) {\n  console.error(e);\n}\n`;
		const findings = checkEmptyCatch("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("detects catch blocks with only whitespace", () => {
		const content = `try {\n  doSomething();\n} catch (e) {\n  \n}\n`;
		const findings = checkEmptyCatch("src/app.ts", content);
		expect(findings).toHaveLength(1);
	});

	it("allows catch with a comment (intentional empty catch)", () => {
		const content = `try {\n  doSomething();\n} catch (e) {\n  // intentionally empty\n}\n`;
		const findings = checkEmptyCatch("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});
});

// ─── checkAnyType ────────────────────────────────────────────────────────

describe("checkAnyType", () => {
	it("detects 'any' type annotation in .ts files", () => {
		const content = `function foo(x: any): void {\n  return;\n}\n`;
		const findings = checkAnyType("src/app.ts", content);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.line).toBe(1);
		expect(findings[0]?.ruleId).toBe("no-any-type");
		expect(findings[0]?.severity).toBe("warning");
	});

	it("skips .d.ts files", () => {
		const content = `declare function foo(x: any): void;\n`;
		const findings = checkAnyType("src/types.d.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("does not flag 'any' in comments or strings", () => {
		const content = `// any type is bad\nconst msg = "any value";\n`;
		const findings = checkAnyType("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("detects multiple any usages", () => {
		const content = `const x: any = 1;\nconst y: any = 2;\n`;
		const findings = checkAnyType("src/app.ts", content);
		expect(findings).toHaveLength(2);
	});

	it("does not flag words containing 'any' like 'many' or 'company'", () => {
		const content = `const many = 1;\nconst company = "acme";\n`;
		const findings = checkAnyType("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("does not flag identifiers ending in 'any' followed by punctuation (#461)", () => {
		const content = [
			"expect(clarify(SPEC, many).questions).toHaveLength(5);",
			"const list = [company, other];",
			"foo(botany);",
			"const x = germany | 0;",
			"type T = Array<Company>;",
			"const arr = many[0];",
		].join("\n");
		const findings = checkAnyType("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("still flags standalone 'any' followed by punctuation", () => {
		const content = [
			"const m: Map<string, any> = new Map();",
			"function f(x: string | any) { return x; }",
			"type U = any[];",
			"type V = [string, any];",
		].join("\n");
		const findings = checkAnyType("src/app.ts", content);
		expect(findings.map((f) => f.line)).toEqual([1, 2, 3, 4]);
	});
});

// ─── checkUnusedImports ──────────────────────────────────────────────────

describe("checkUnusedImports", () => {
	it("detects unused named imports", () => {
		const content = `import { foo, bar } from "./mod";\nconst x = foo();\n`;
		const findings = checkUnusedImports("src/app.ts", content);
		// bar is unused
		expect(findings).toHaveLength(1);
		expect(findings[0]?.message).toContain("bar");
		expect(findings[0]?.ruleId).toBe("unused-import");
	});

	it("does not flag used imports", () => {
		const content = `import { foo } from "./mod";\nconst x = foo();\n`;
		const findings = checkUnusedImports("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("handles type imports (should not flag)", () => {
		const content = `import type { Foo } from "./mod";\nconst x: Foo = {};\n`;
		const findings = checkUnusedImports("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("strips inline type modifiers before checking usage (#368)", () => {
		const content = `import { Database, type Bindings, type Row as R } from "bun:sqlite";\nconst db = new Database();\nconst b: Bindings = [];\nconst r: R = {};\n`;
		const findings = checkUnusedImports("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("keeps a binding literally named `type` when aliased (`type as Kind`)", () => {
		const content = `import { type as Kind } from "./mod";\nconst k = Kind;\n`;
		const findings = checkUnusedImports("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});

	it("reports an unused inline type import by its bare name", () => {
		const content = `import { foo, type Unused } from "./mod";\nfoo();\n`;
		const findings = checkUnusedImports("src/app.ts", content);
		expect(findings.map((f) => f.message)).toEqual([
			"Import 'Unused' appears unused",
		]);
	});
});

// ─── runBuiltinChecks ────────────────────────────────────────────────────

describe("runBuiltinChecks", () => {
	it("aggregates findings from all checks", () => {
		const content = [
			`import { unused } from "./mod";`,
			`console.log("bad");`,
			`// TODO: fix later`,
			`const x: any = 1;`,
			`try { f(); } catch (e) {}`,
			`password="secret123"`,
		].join("\n");

		const findings = runBuiltinChecks("src/app.ts", content);
		// Should have findings from multiple checks
		expect(findings.length).toBeGreaterThanOrEqual(4);

		// Verify all findings have correct tool
		for (const f of findings) {
			expect(f.tool).toBe("builtin");
			expect(f.file).toBe("src/app.ts");
		}
	});

	it("returns empty for clean files", () => {
		const content = `import { foo } from "./mod";\nconst x = foo();\n`;
		const findings = runBuiltinChecks("src/app.ts", content);
		expect(findings).toHaveLength(0);
	});
});

// ─── Non-code data files (#372) ─────────────────────────────────────────

describe("runBuiltinChecks on non-code data files", () => {
	const recordedDiff = [
		"+import { unused } from '../data/cloud-landing';",
		"+console.log('debug');",
		"+// TODO: fix later",
		"+const x: any = 1;",
		"+try { f(); } catch (e) {}",
	].join("\n");
	// Padded past the 500-line file-size threshold as well
	const jsonFixture = `${JSON.stringify({ input: { diff: recordedDiff } }, null, "\t")}${"\n".repeat(600)}`;

	it("skips code-smell checks for .json, .jsonl, .yml, .yaml and .md files", () => {
		for (const file of [
			"packages/core/src/__golden__/decisions/review.json",
			"scripts/golden-corpus/cases.jsonl",
			".github/workflows/ci.yml",
			"config.yaml",
			"docs/guide.md",
		]) {
			expect(runBuiltinChecks(file, jsonFixture)).toEqual([]);
		}
	});

	it("skips code-smell checks even when a data file holds raw code lines", () => {
		const raw = [
			'import { unused } from "./mod";',
			'console.log("bad");',
			"// TODO: fix later",
		].join("\n");
		expect(runBuiltinChecks("fixtures/snippet.json", raw)).toEqual([]);
	});

	it("still scans data files for hardcoded secrets", () => {
		const findings = runBuiltinChecks(
			"config/settings.yml",
			'api_key: "sk_live_abcdef1234567890"',
		);
		expect(findings.map((f) => f.ruleId)).toEqual(["hardcoded-secret"]);
	});

	it("still runs code checks on .mjs and .cjs files", () => {
		for (const file of ["src/app.mjs", "src/app.cjs"]) {
			const ids = runBuiltinChecks(file, 'console.log("bad");').map(
				(f) => f.ruleId,
			);
			expect(ids).toContain("no-console-log");
		}
	});

	it("does not report console usage in scripts/ but keeps other checks (#380)", () => {
		const ids = runBuiltinChecks(
			"scripts/generate-schemas.ts",
			'console.log("wrote schema");\nconst token = "sk_live_abcdef1234567890";\n',
		).map((f) => f.ruleId);
		expect(ids).not.toContain("no-console-log");
		expect(ids).toContain("hardcoded-secret");
	});
});
