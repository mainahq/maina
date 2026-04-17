/**
 * Tests for built-in verify checks.
 *
 * Each check is a pure function: (filePath, content) => Finding[].
 * No I/O, no side effects — just string analysis.
 */

import { describe, expect, it } from "bun:test";
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
