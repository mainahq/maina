import { describe, expect, it } from "bun:test";
import { resolveReferencedFunctions } from "../ai-review";

describe("resolveReferencedFunctions", () => {
	it("should extract function calls from added lines in diff", () => {
		const diff = `--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,5 @@ function existing() {
+  const result = validateInput(data);
+  processResult(result);
   return true;`;

		const entities = [
			{
				name: "validateInput",
				kind: "function" as const,
				startLine: 1,
				endLine: 5,
				filePath: "src/utils.ts",
				body: "function validateInput(data: unknown) {\n  if (!data) return null;\n  return data;\n}",
			},
			{
				name: "processResult",
				kind: "function" as const,
				startLine: 10,
				endLine: 15,
				filePath: "src/utils.ts",
				body: "function processResult(result: unknown) {\n  console.log(result);\n}",
			},
			{
				name: "unusedFunction",
				kind: "function" as const,
				startLine: 20,
				endLine: 25,
				filePath: "src/other.ts",
				body: "function unusedFunction() { return 1; }",
			},
		];

		const result = resolveReferencedFunctions(diff, entities);

		expect(result).toHaveLength(2);
		expect(result[0]?.name).toBe("validateInput");
		expect(result[1]?.name).toBe("processResult");
	});

	it("should cap at 3 referenced functions per file", () => {
		const diff = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,7 @@
+  fn1();
+  fn2();
+  fn3();
+  fn4();`;

		const entities = [
			{
				name: "fn1",
				kind: "function" as const,
				startLine: 1,
				endLine: 3,
				filePath: "src/a.ts",
				body: "function fn1() {}",
			},
			{
				name: "fn2",
				kind: "function" as const,
				startLine: 1,
				endLine: 3,
				filePath: "src/b.ts",
				body: "function fn2() {}",
			},
			{
				name: "fn3",
				kind: "function" as const,
				startLine: 1,
				endLine: 3,
				filePath: "src/c.ts",
				body: "function fn3() {}",
			},
			{
				name: "fn4",
				kind: "function" as const,
				startLine: 1,
				endLine: 3,
				filePath: "src/d.ts",
				body: "function fn4() {}",
			},
		];

		const result = resolveReferencedFunctions(diff, entities);
		expect(result).toHaveLength(3);
	});

	it("should return empty array when no functions match", () => {
		const diff = `+++ b/src/app.ts
@@ -1,1 +1,2 @@
+  const x = 42;`;

		const result = resolveReferencedFunctions(diff, []);
		expect(result).toHaveLength(0);
	});
});
