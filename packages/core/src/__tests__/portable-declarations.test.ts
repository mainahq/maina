/**
 * Portable public types (issue #292 follow-up from the #294 review).
 *
 * A Node TypeScript consumer of `@mainahq/core` with `skipLibCheck: false`
 * cannot resolve Bun's built-in modules. Emits core's declarations with tsc
 * and fails if any non-test declaration imports a `bun:*` module or a
 * Bun-only driver entry point (`drizzle-orm/bun-sqlite`). Internal use of
 * those modules is fine as long as no exported type reaches them.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const CORE_DIR = join(import.meta.dir, "..", "..");
const TSC = join(CORE_DIR, "..", "..", "node_modules", ".bin", "tsc");
const outDir = mkdtempSync(join(tmpdir(), "maina-core-dts-"));

afterAll(() => {
	rmSync(outDir, { recursive: true, force: true });
});

const BUN_ONLY_IMPORT =
	/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:bun:[^"']+|drizzle-orm\/bun-sqlite)["']/;

function listDeclarations(dir: string): readonly string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			return name === "__tests__" || name === "__golden__"
				? []
				: listDeclarations(full);
		}
		return name.endsWith(".d.ts") && !/\.(?:test|spec)\.d\.ts$/.test(name)
			? [full]
			: [];
	});
}

describe("published declarations", () => {
	test(
		"no public type imports a bun:* module or a Bun-only driver",
		() => {
			const proc = Bun.spawnSync(
				[
					TSC,
					"-p",
					"tsconfig.json",
					"--noEmit",
					"false",
					"--declaration",
					"--emitDeclarationOnly",
					"--declarationMap",
					"false",
					"--sourceMap",
					"false",
					"--outDir",
					outDir,
				],
				{ cwd: CORE_DIR, stdout: "pipe", stderr: "pipe" },
			);
			// Type errors are `bun run typecheck`'s job; tsc still emits every
			// declaration it can, which is all this check needs.
			const declarations = listDeclarations(outDir);
			if (declarations.length === 0) {
				expect(proc.stdout.toString() + proc.stderr.toString()).toBe("");
			}
			expect(declarations.length).toBeGreaterThan(0);
			const offenders = declarations
				.filter((file) => BUN_ONLY_IMPORT.test(readFileSync(file, "utf8")))
				.map((file) => relative(outDir, file).split(sep).join("/"));
			expect(offenders).toEqual([]);
		},
		{ timeout: 120_000 },
	);
});
