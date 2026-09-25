/**
 * Published declarations under Node types (#392).
 *
 * The built `dist/index.d.ts` of every published package must typecheck in a
 * plain Node TypeScript project (`types: ["node"]`, `skipLibCheck: false`)
 * and must not name a Bun-only module or a Drizzle type.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	checkDeclarations,
	findLeakedImports,
	publishedDeclarations,
} from "../check-dts";

const ROOT = resolve(import.meta.dir, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "maina-check-dts-"));

afterAll(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function fixture(name: string, dts: string): string {
	const dir = join(tmp, name);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "index.d.ts");
	writeFileSync(file, dts);
	return file;
}

describe("findLeakedImports", () => {
	test.each([
		['import { Database } from "bun:sqlite";', "bun:sqlite"],
		['import type { BunFile } from "bun";', "bun"],
		[
			'import { drizzle } from "drizzle-orm/bun-sqlite";',
			"drizzle-orm/bun-sqlite",
		],
		[
			'import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";',
			"drizzle-orm/sqlite-core",
		],
		['type T = import("drizzle-orm").SQL;', "drizzle-orm"],
		['/// <reference types="bun-types" />', "bun-types"],
		['/// <reference types="bun" />', "bun"],
	])("flags %s", (dts, specifier) => {
		expect(findLeakedImports(dts)).toEqual([specifier]);
	});

	test("allows Node built-ins and ordinary dependencies", () => {
		const dts = [
			'import { z } from "zod";',
			'import type { Readable } from "node:stream";',
			'export * from "@mainahq/core";',
			"/** Talks to bun:sqlite at runtime; types stay driver-neutral. */",
		].join("\n");
		expect(findLeakedImports(dts)).toEqual([]);
	});
});

describe("publishedDeclarations", () => {
	test("lists every public package that ships types", () => {
		expect(publishedDeclarations(ROOT)).toEqual([
			join(ROOT, "packages/core/dist/index.d.ts"),
			join(ROOT, "packages/mcp/dist/index.d.ts"),
		]);
	});
});

describe("checkDeclarations", () => {
	test("passes a declaration that typechecks under Node types", () => {
		const file = fixture(
			"clean",
			'import type { Readable } from "node:stream";\nexport declare function open(r: Readable): Promise<void>;\n',
		);
		expect(checkDeclarations(ROOT, [file])).toEqual({
			ok: true,
			value: undefined,
		});
	}, 60_000);

	test("fails a declaration that needs Bun's types", () => {
		const file = fixture(
			"bun",
			'import type { Database } from "bun:sqlite";\nexport declare const db: Database;\n',
		);
		const result = checkDeclarations(ROOT, [file]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("bun:sqlite");
	}, 60_000);

	test("typechecks without Bun's globals, not just the import scan", () => {
		const file = fixture(
			"bun-global",
			"export declare function read(path: string): Bun.BunFile;\n",
		);
		const result = checkDeclarations(ROOT, [file]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("tsc under Node types failed");
		expect(result.error).toContain("Bun");
	}, 60_000);

	test("reports a missing build instead of passing", () => {
		const result = checkDeclarations(ROOT, [join(tmp, "absent", "index.d.ts")]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("bun run build");
	});
});

describe("CI wiring", () => {
	test("CI builds the published packages and runs the check", () => {
		const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf-8");
		expect(ci).toMatch(/^\s+run: bun run check:dts\s*$/m);
		expect(ci).not.toMatch(/check:dts[\s\S]{0,80}continue-on-error:\s*true/);
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
		expect(pkg.scripts["check:dts"]).toContain("build");
		expect(pkg.scripts["check:dts"]).toContain("scripts/check-dts.ts");
	});
});
