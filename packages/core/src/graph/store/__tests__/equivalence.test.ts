/**
 * Equivalence property (FR-GRAPH-2): after any sequence of edits, adds,
 * deletes and renames, `updateFiles` over the touched paths leaves the store
 * byte-for-byte equal to a full rebuild of the final tree into a fresh
 * database. Repos and edit scripts come from a seeded generator, so a failure
 * prints the seed and step that reproduce it.
 */

import { describe, expect, test } from "bun:test";
import { indexRepo, updateFiles } from "../index";
import { createRepo, dumpTables, ROOT, unwrap } from "./helpers";

/** mulberry32: small, fast, deterministic. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Rand = Readonly<{
	int: (n: number) => number;
	pick: <T>(items: readonly T[]) => T;
	some: <T>(items: readonly T[], max: number) => readonly T[];
}>;

function rand(seed: number): Rand {
	const next = rng(seed);
	const int = (n: number): number => Math.floor(next() * n);
	const pick = <T>(items: readonly T[]): T => items[int(items.length)] as T;
	return {
		int,
		pick,
		some: (items, max) => {
			const count = int(max + 1);
			return [...new Set(Array.from({ length: count }, () => pick(items)))];
		},
	};
}

// A small shared pool of names makes collisions, dangling references and
// re-resolution after an edit elsewhere common rather than rare.
const NAMES = ["alpha", "beta", "gamma", "delta", "Shape", "Circle"] as const;
const TS_FILES = [
	"src/a.ts",
	"src/b.ts",
	"src/c.ts",
	"src/lib/d.ts",
	"src/lib/index.ts",
];
const PY_FILES = [
	"py/pkg/__init__.py",
	"py/pkg/one.py",
	"py/pkg/two.py",
	"py/main.py",
];
const GO_FILES = ["go/geo/a.go", "go/geo/b.go", "go/cmd/main.go"];

const relative = (from: string, to: string): string => {
	const fromDir = from.split("/").slice(0, -1);
	const toParts = to.replace(/\.ts$/, "").split("/");
	let common = 0;
	while (common < fromDir.length && fromDir[common] === toParts[common])
		common++;
	const up = fromDir.length - common;
	const rest = toParts.slice(common).join("/");
	return up === 0 ? `./${rest}` : `${"../".repeat(up)}${rest}`;
};

function tsSource(r: Rand, path: string): string {
	const lines: string[] = [];
	for (const target of r.some(TS_FILES, 2)) {
		if (target === path) continue;
		const names = r.some(NAMES, 2);
		lines.push(
			r.int(3) === 0
				? `import * as ns from "${relative(path, target)}";`
				: `import { ${names.join(", ") || "alpha"} } from "${relative(path, target)}";`,
		);
	}
	for (const name of r.some(NAMES, 3)) {
		if (name === "Shape" || name === "Circle") {
			const base = r.int(2) === 0 ? ` extends ${r.pick(NAMES)}` : "";
			lines.push(
				`export class ${name}${base} {`,
				`\tarea(): number { return this.size() + ${r.pick(NAMES)}(); }`,
				"\tsize(): number { return 1; }",
				"}",
			);
		} else {
			const calls = r
				.some(NAMES, 3)
				.map((c) => (r.int(3) === 0 ? `ns.${c}()` : `${c}()`));
			lines.push(
				`export function ${name}(): number { return ${[...calls, "0"].join(" + ")}; }`,
			);
		}
	}
	return `${lines.join("\n")}\n`;
}

function pySource(r: Rand, path: string): string {
	const lines: string[] = [];
	for (const target of r.some(PY_FILES, 2)) {
		if (target === path) continue;
		const module = target
			.replace(/^py\//, "")
			.replace(/\/__init__\.py$|\.py$/, "")
			.replaceAll("/", ".");
		lines.push(
			r.int(2) === 0
				? `from ${module} import ${r.some(NAMES, 2).join(", ") || "alpha"}`
				: `import ${module}`,
		);
	}
	for (const name of r.some(NAMES, 3)) {
		lines.push(
			`def ${name}():`,
			`    return ${[...r.some(NAMES, 2).map((c) => `${c}()`), "0"].join(" + ")}`,
			"",
		);
	}
	return `${lines.join("\n")}\n`;
}

function goSource(r: Rand, path: string): string {
	const pkg = path.split("/").at(-2) ?? "main";
	const lines = [`package ${pkg}`, ""];
	if (r.int(2) === 0 && pkg !== "geo")
		lines.push('import "github.com/acme/repo/go/geo"', "");
	for (const name of r.some(NAMES, 3)) {
		const calls = r
			.some(NAMES, 2)
			.map((c) => (r.int(3) === 0 ? `geo.${c}()` : `${c}()`));
		lines.push(`func ${name}() int { return ${[...calls, "0"].join(" + ")} }`);
	}
	return `${lines.join("\n")}\n`;
}

function source(r: Rand, path: string): string {
	if (path.endsWith(".ts")) return tsSource(r, path);
	if (path.endsWith(".py")) return pySource(r, path);
	return goSource(r, path);
}

const ALL_PATHS = [...TS_FILES, ...PY_FILES, ...GO_FILES];

/** Index the final tree from scratch into a fresh database. */
async function fullRebuild(tree: ReadonlyMap<string, string>) {
	const fresh = createRepo(Object.fromEntries(tree));
	unwrap(await indexRepo(fresh.ports, ROOT));
	return dumpTables(fresh.db);
}

describe("incremental update equals a full rebuild", () => {
	const SEEDS = Array.from({ length: 12 }, (_, i) => 1000 + i * 7919);

	for (const seed of SEEDS) {
		test(`seed ${seed}`, async () => {
			const r = rand(seed);
			const tree = new Map<string, string>();
			for (const path of ALL_PATHS) {
				if (r.int(4) !== 0) tree.set(path, source(r, path));
			}
			const repo = createRepo(Object.fromEntries(tree));
			unwrap(await indexRepo(repo.ports, ROOT));

			for (let step = 0; step < 6; step++) {
				const touched: string[] = [];
				for (let op = 0; op <= r.int(3); op++) {
					const path = r.pick(ALL_PATHS);
					const present = tree.has(path);
					const action = r.int(4);
					if (present && action === 0) {
						tree.delete(path);
						await repo.remove(path);
						touched.push(path);
					} else if (present && action === 1) {
						// Rename to another free path of the same language.
						const ext = path.slice(path.lastIndexOf("."));
						const free = ALL_PATHS.filter(
							(p) => p.endsWith(ext) && !tree.has(p),
						);
						if (free.length === 0) continue;
						const to = r.pick(free);
						const content = tree.get(path) ?? "";
						tree.delete(path);
						tree.set(to, content);
						await repo.remove(path);
						await repo.write(to, content);
						touched.push(path, to);
					} else {
						const content = source(r, path);
						tree.set(path, content);
						await repo.write(path, content);
						touched.push(path);
					}
				}
				unwrap(await updateFiles(repo.ports, ROOT, touched));
				const expected = await fullRebuild(tree);
				expect({ seed, step, tables: dumpTables(repo.db) }).toEqual({
					seed,
					step,
					tables: expected,
				});
			}
		});
	}
});
