/**
 * The published declarations typecheck for a Node consumer (#392).
 *
 * `portable-declarations.test.ts` scans per-file declarations for `bun:*`
 * imports. What npm users get is the bundled `dist/index.d.ts`, so this test
 * builds it exactly as the release does and typechecks a consumer of it the
 * way a Node project would: Node types only (no bun-types) and
 * `skipLibCheck: false`. Any public type that reaches `bun:sqlite` or a
 * drizzle driver (whose own declarations need optional peers such as `gel`
 * and `mysql2`) fails here with TS2307 and friends.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const CORE_DIR = join(import.meta.dir, "..", "..");
const ROOT = join(CORE_DIR, "..", "..");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");
const BUNUP = join(ROOT, "node_modules", ".bin", "bunup");
// Inside core's node_modules so the bundle resolves core's own dependencies
// (zod, ai, ...) the way an installed package would, and git/biome skip it.
const work = join(
	CORE_DIR,
	"node_modules",
	".cache",
	`node-consumer-dts-${process.pid}-${Date.now()}`,
);
const outDir = join(work, "dist");

function run(argv: readonly string[], cwd: string) {
	const proc = Bun.spawnSync([...argv], {
		cwd,
		// `CI=true` as in the release job: bunup fails on declaration errors.
		env: { ...process.env, CI: "true" },
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: proc.exitCode ?? -1,
		output: proc.stdout.toString() + proc.stderr.toString(),
	};
}

let build = { exitCode: -1, output: "" };

beforeAll(() => {
	mkdirSync(work, { recursive: true });
	// Relative: bunup 0.16 re-roots an absolute out-dir under the package for
	// declarations. Fresh, so no clean (bunup refuses to clean node_modules).
	build = run(
		[BUNUP, "--out-dir", relative(CORE_DIR, outDir), "--no-clean"],
		CORE_DIR,
	);
}, 120_000);

afterAll(() => {
	rmSync(work, { recursive: true, force: true });
});

describe("bundled dist/index.d.ts", () => {
	test("builds", () => {
		expect({
			exitCode: build.exitCode,
			output: build.exitCode === 0 ? "" : build.output,
		}).toEqual({
			exitCode: 0,
			output: "",
		});
	});

	test("imports no bun:* module and no drizzle-orm entry point", () => {
		const text = readFileSync(join(outDir, "index.d.ts"), "utf8");
		const imports = [
			...text.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g),
		]
			.map((m) => m[1] ?? "")
			.filter(
				(spec) => spec.startsWith("bun:") || spec.startsWith("drizzle-orm"),
			);
		expect([...new Set(imports)]).toEqual([]);
	});

	test(
		"typechecks for a Node consumer with skipLibCheck: false",
		() => {
			writeFileSync(
				join(work, "consumer.mts"),
				[
					'import * as core from "./dist/index.js";',
					"export const version: string = core.VERSION;",
					"",
				].join("\n"),
			);
			writeFileSync(
				join(work, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						strict: true,
						noEmit: true,
						skipLibCheck: false,
						target: "es2022",
						lib: ["es2023"],
						module: "nodenext",
						moduleResolution: "nodenext",
						types: ["node"],
						typeRoots: [join(CORE_DIR, "node_modules", "@types")],
					},
					files: ["consumer.mts"],
				}),
			);
			const tsc = run([TSC, "-p", "tsconfig.json"], work);
			expect({ exitCode: tsc.exitCode, output: tsc.output.trim() }).toEqual({
				exitCode: 0,
				output: "",
			});
		},
		{ timeout: 120_000 },
	);
});
