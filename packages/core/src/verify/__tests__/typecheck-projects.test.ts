import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	groupFilesByProject,
	rebaseFindings,
	runTypecheck,
} from "../typecheck";

// Regression for #374: the built-in typecheck ran one root `tsc`, ignoring
// package tsconfigs, so package-local types/deps looked missing.

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const has = (paths: string[]) => (p: string) => paths.includes(p);

describe("groupFilesByProject", () => {
	test("groups each file under its nearest tsconfig directory", () => {
		const exists = has([
			"/r/tsconfig.json",
			"/r/packages/a/tsconfig.json",
			"/r/packages/b/tsconfig.json",
		]);
		const groups = groupFilesByProject(
			[
				"packages/a/src/x.ts",
				"packages/a/src/deep/y.ts",
				"packages/b/src/z.tsx",
				"scripts/tool.ts",
			],
			"/r",
			exists,
		);
		expect(groups).toEqual(
			new Map([
				["packages/a", ["packages/a/src/x.ts", "packages/a/src/deep/y.ts"]],
				["packages/b", ["packages/b/src/z.tsx"]],
				["", ["scripts/tool.ts"]],
			]),
		);
	});

	test("ignores non-TypeScript files and files with no tsconfig", () => {
		const groups = groupFilesByProject(
			["README.md", "a.json", "src/x.ts"],
			"/r",
			has([]),
		);
		expect(groups.size).toBe(0);
	});
});

describe("rebaseFindings", () => {
	test("prefixes project-relative paths with the project dir", () => {
		const out = rebaseFindings(
			[
				{
					tool: "tsc",
					file: "src/x.ts",
					line: 1,
					message: "m",
					severity: "error",
				},
			],
			"packages/a",
		);
		expect(out[0]?.file).toBe("packages/a/src/x.ts");
	});

	test("normalises backslash paths to forward slashes", () => {
		const out = rebaseFindings(
			[
				{
					tool: "tsc",
					file: "src\\deep\\x.ts",
					line: 1,
					message: "m",
					severity: "error",
				},
			],
			"packages/a",
		);
		expect(out[0]?.file).toBe("packages/a/src/deep/x.ts");
	});

	test("leaves root-project paths unchanged", () => {
		const f = {
			tool: "tsc",
			file: "src/x.ts",
			line: 1,
			message: "m",
			severity: "error" as const,
		};
		expect(rebaseFindings([f], "")[0]?.file).toBe("src/x.ts");
	});
});

describe("runTypecheck with workspace packages", () => {
	const tscAvailable = Bun.which("tsc") !== null;

	test.skipIf(!tscAvailable)(
		"uses the package tsconfig, not the root one",
		async () => {
			const root = mkdtempSync(join(tmpdir(), "maina-tc-"));
			dirs.push(root);
			// Root config would reject implicit any; the package allows it.
			writeFileSync(
				join(root, "tsconfig.json"),
				JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
			);
			const pkg = join(root, "packages", "a");
			mkdirSync(join(pkg, "src"), { recursive: true });
			writeFileSync(
				join(pkg, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: { strict: false, noEmit: true },
					include: ["src"],
				}),
			);
			writeFileSync(
				join(pkg, "src", "x.ts"),
				"export function f(a) { return a; }\n",
			);

			const result = await runTypecheck(["packages/a/src/x.ts"], root);

			expect(result.skipped).toBe(false);
			expect(result.findings).toEqual([]);
		},
		30_000,
	);

	test.skipIf(!tscAvailable)(
		"reports package errors with repo-relative paths",
		async () => {
			const root = mkdtempSync(join(tmpdir(), "maina-tc-"));
			dirs.push(root);
			writeFileSync(join(root, "tsconfig.json"), "{}");
			const pkg = join(root, "packages", "a");
			mkdirSync(join(pkg, "src"), { recursive: true });
			writeFileSync(
				join(pkg, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: { strict: true, noEmit: true },
					include: ["src"],
				}),
			);
			writeFileSync(join(pkg, "src", "x.ts"), "const n: number = 'no';\n");

			const result = await runTypecheck(["packages/a/src/x.ts"], root);

			expect(result.findings.map((f) => f.file)).toEqual([
				"packages/a/src/x.ts",
			]);
		},
		30_000,
	);
});
