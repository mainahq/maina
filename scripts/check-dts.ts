#!/usr/bin/env bun
/**
 * Published declarations guard (#392).
 *
 * Typechecks the built `dist/index.d.ts` of every public package that ships
 * types in a plain Node TypeScript project (`types: ["node"]`,
 * `skipLibCheck: false`), and fails if one names a Bun-only module
 * (`bun`, `bun:*`, `bun-types`) or a Drizzle type (`drizzle-orm/*`): a Node
 * consumer gets TS2307 on the first, and the second ties the published
 * API to core's storage internals, which stay behind `DbPort`.
 *
 * Run after building the published packages:
 *     bun run check:dts
 */

import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

const FORBIDDEN =
	/^(?:bun(?::.*)?|bun-types|@types\/bun|drizzle-orm(?:\/.*)?)$/;

const SPECIFIERS = [
	/\bfrom\s*["']([^"']+)["']/g,
	/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
	/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
	/^\s*import\s*["']([^"']+)["']/gm,
	/\/\/\/\s*<reference\s+types\s*=\s*["']([^"']+)["']/g,
];

/** Module specifiers in `dts` that a published declaration must not name. */
export function findLeakedImports(dts: string): string[] {
	const found = SPECIFIERS.flatMap((re) =>
		[...dts.matchAll(re)].map((m) => m[1] ?? ""),
	);
	return [...new Set(found.filter((s) => FORBIDDEN.test(s)))];
}

type PackageJson = { private?: boolean; types?: string };

/** The `types` entry of every non-private package under `packages/`. */
export function publishedDeclarations(root: string): string[] {
	const packagesDir = join(root, "packages");
	return readdirSync(packagesDir)
		.sort()
		.flatMap((name) => {
			const manifest = join(packagesDir, name, "package.json");
			if (!existsSync(manifest)) return [];
			const pkg = JSON.parse(readFileSync(manifest, "utf-8")) as PackageJson;
			return pkg.private || !pkg.types
				? []
				: [join(packagesDir, name, pkg.types)];
		});
}

function nodeTsconfig(root: string, files: readonly string[]): string {
	return JSON.stringify({
		compilerOptions: {
			strict: true,
			noEmit: true,
			skipLibCheck: false,
			target: "ES2022",
			module: "NodeNext",
			moduleResolution: "NodeNext",
			types: ["node"],
			typeRoots: [join(root, "node_modules", "@types")],
		},
		files,
	});
}

function runTsc(root: string, files: readonly string[]): Result<void> {
	const dir = mkdtempSync(join(tmpdir(), "maina-check-dts-"));
	try {
		const config = join(dir, "tsconfig.json");
		writeFileSync(config, nodeTsconfig(root, files));
		const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
		const proc = Bun.spawnSync([process.execPath, tsc, "-p", config], {
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
		});
		if (proc.exitCode === 0) return { ok: true, value: undefined };
		const output = `${proc.stdout.toString()}${proc.stderr.toString()}`.trim();
		return { ok: false, error: `tsc under Node types failed:\n${output}` };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Leak scan plus a Node-types typecheck of `files`; the error says what failed. */
export function checkDeclarations(
	root: string,
	files: readonly string[],
): Result<void> {
	const missing = files.filter((file) => !existsSync(file));
	if (missing.length > 0) {
		const list = missing.map((f) => `  ${relative(root, f)}`).join("\n");
		return {
			ok: false,
			error: `missing declarations (run \`bun run build\` first):\n${list}`,
		};
	}
	const leaks = files.flatMap((file) =>
		findLeakedImports(readFileSync(file, "utf-8")).map(
			(spec) => `  ${relative(root, file)}: "${spec}"`,
		),
	);
	if (leaks.length > 0) {
		return {
			ok: false,
			error: `published declarations name Bun-only or Drizzle modules:\n${leaks.join("\n")}`,
		};
	}
	return runTsc(root, files);
}

if (import.meta.main) {
	const root = resolve(import.meta.dir, "..");
	const files = publishedDeclarations(root);
	const result = checkDeclarations(root, files);
	if (!result.ok) {
		process.stderr.write(`${result.error}\n`);
		process.exit(1);
	}
	process.stdout.write(
		`published declarations typecheck under Node types (${files.length} packages)\n`,
	);
}
