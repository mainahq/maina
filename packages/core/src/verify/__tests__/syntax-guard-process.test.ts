/**
 * Issue #434: the syntax guard spawns Biome and the per-language linters
 * (ruff, go vet, clippy, ...) through an injected `ProcessPort`, so its
 * behaviour is tested without real toolchains (go vet alone could run past
 * bun's 5s default timeout under load).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProfile } from "../../language/profile";
import { createFakeProcess } from "../../ports/testing";
import { syntaxGuard } from "../syntax-guard";

const BIOME_ARGS =
	"check --reporter=json --no-errors-on-unmatched --colors=off";

function biomeReport(severity: "error" | "warning"): string {
	return JSON.stringify({
		summary: { changed: 0, unchanged: 1, errors: 1, warnings: 0 },
		diagnostics: [
			{
				severity,
				message: "expected `)` but instead found `{`",
				category: "parse",
				location: {
					path: "src/a.ts",
					start: { line: 2, column: 7 },
					end: { line: 2, column: 8 },
				},
				advices: [],
			},
		],
		command: "check",
	});
}

describe("syntaxGuard over an injected ProcessPort", () => {
	let root: string;

	beforeEach(() => {
		// A temp dir has no node_modules/.bin above it, so the bare `biome`
		// command is what gets spawned.
		root = mkdtempSync(join(tmpdir(), "maina-syntax-port-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("biome exiting 0 passes, spawned in the explicit root", async () => {
		const proc = createFakeProcess({ [`biome ${BIOME_ARGS} src/a.ts`]: {} });

		const result = await syntaxGuard(["src/a.ts"], root, undefined, proc);

		expect(result.ok).toBe(true);
		expect(proc.calls()).toEqual([
			{
				argv: [
					"biome",
					"check",
					"--reporter=json",
					"--no-errors-on-unmatched",
					"--colors=off",
					"src/a.ts",
				],
				options: { cwd: root },
			},
		]);
	});

	test("biome error diagnostics reject with structured errors", async () => {
		const proc = createFakeProcess({
			[`biome ${BIOME_ARGS} src/a.ts`]: {
				exitCode: 1,
				stdout: biomeReport("error"),
			},
		});

		const result = await syntaxGuard(["src/a.ts"], root, undefined, proc);

		expect(result).toEqual({
			ok: false,
			error: [
				{
					file: "src/a.ts",
					line: 2,
					column: 7,
					message: "expected `)` but instead found `{`",
					severity: "error",
				},
			],
		});
	});

	test("biome warnings alone do not reject", async () => {
		const proc = createFakeProcess({
			[`biome ${BIOME_ARGS} src/a.ts`]: {
				exitCode: 1,
				stdout: biomeReport("warning"),
			},
		});

		const result = await syntaxGuard(["src/a.ts"], root, undefined, proc);

		expect(result.ok).toBe(true);
	});

	test("biome failing to spawn is reported as an error diagnostic", async () => {
		const proc = createFakeProcess();

		const result = await syntaxGuard(["src/a.ts"], root, undefined, proc);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toHaveLength(1);
		expect(result.error[0]?.severity).toBe("error");
		expect(result.error[0]?.message).toStartWith("Failed to run biome:");
	});

	test("go vet stderr is parsed through the port", async () => {
		const proc = createFakeProcess({
			"go vet main.go": {
				exitCode: 1,
				stderr: "# example\nvet: note\nmain.go:4:2: undefined: x\n",
			},
		});

		const result = await syntaxGuard(["main.go"], root, getProfile("go"), proc);

		expect(result).toEqual({
			ok: false,
			error: [
				{
					file: "main.go",
					line: 4,
					column: 2,
					message: "undefined: x",
					severity: "error",
				},
			],
		});
		expect(proc.calls()[0]?.options).toEqual({ cwd: root });
	});

	test("ruff JSON on stdout is parsed through the port", async () => {
		const proc = createFakeProcess({
			"ruff check --output-format=json app.py": {
				exitCode: 1,
				stdout: JSON.stringify([
					{
						code: "F821",
						message: "Undefined name `y`",
						filename: "app.py",
						location: { row: 3, column: 1 },
					},
				]),
			},
		});

		const result = await syntaxGuard(
			["app.py"],
			root,
			getProfile("python"),
			proc,
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error[0]).toMatchObject({
			file: "app.py",
			line: 3,
			severity: "error",
		});
	});

	test("a clean language linter run passes", async () => {
		const proc = createFakeProcess({
			"cargo clippy --message-format=json -- lib.rs": { stdout: "" },
		});

		const result = await syntaxGuard(
			["lib.rs"],
			root,
			getProfile("rust"),
			proc,
		);

		expect(result.ok).toBe(true);
		expect(proc.calls()).toHaveLength(1);
	});

	test("a missing language linter is reported with its tool name", async () => {
		const proc = createFakeProcess();

		const result = await syntaxGuard(["main.go"], root, getProfile("go"), proc);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error[0]?.message).toStartWith(
			`Failed to run ${getProfile("go").syntaxTool}:`,
		);
	});
});
