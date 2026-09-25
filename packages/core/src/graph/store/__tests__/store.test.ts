import { describe, expect, test } from "bun:test";
import type { DbPort } from "../../../ports/index";
import { createMemoryDb } from "../../../ports/testing";
import { indexRepo, updateFiles } from "../index";
import {
	createRepo,
	dumpTables,
	edgeRows,
	nodeIds,
	parseSpy,
	ROOT,
	snapshot,
	unwrap,
} from "./helpers";

const MATH = `export function square(n: number): number {
	return n * n;
}

export function cube(n: number): number {
	return n * square(n);
}
`;

const SHAPES = `import { square } from "./math";

export class Circle {
	constructor(private r: number) {}
	area(): number {
		return square(this.r) * this.scale();
	}
	scale(): number {
		return 3.14;
	}
}
`;

const INDEX = `import * as m from "./math";
import { Circle } from "./shapes";

export function main(): number {
	return new Circle(2).area() + m.cube(3);
}
`;

const FILES = {
	"src/math.ts": MATH,
	"src/shapes.ts": SHAPES,
	"src/index.ts": INDEX,
	"README.md": "# not code\n",
};

describe("indexRepo", () => {
	test("stores files, symbol nodes and resolved cross-file edges", async () => {
		const repo = createRepo(FILES);
		unwrap(await indexRepo(repo.ports, ROOT));
		const graph = snapshot(repo.db);

		expect(graph.files.map((f) => [f.path, f.lang, f.isTest])).toEqual([
			["src/index.ts", "typescript", false],
			["src/math.ts", "typescript", false],
			["src/shapes.ts", "typescript", false],
		]);
		expect(nodeIds(graph)).toEqual([
			"src/index.ts",
			"src/index.ts#main",
			"src/math.ts",
			"src/math.ts#cube",
			"src/math.ts#square",
			"src/shapes.ts",
			"src/shapes.ts#Circle",
			"src/shapes.ts#Circle.area",
			"src/shapes.ts#Circle.constructor",
			"src/shapes.ts#Circle.scale",
		]);
		expect(edgeRows(graph)).toEqual([
			"src/index.ts -imports-> src/math.ts",
			"src/index.ts -imports-> src/shapes.ts",
			"src/index.ts#main -calls-> src/math.ts#cube",
			"src/index.ts#main -calls-> src/shapes.ts#Circle",
			"src/math.ts#cube -calls-> src/math.ts#square",
			"src/shapes.ts -imports-> src/math.ts",
			"src/shapes.ts#Circle.area -calls-> src/math.ts#square",
			"src/shapes.ts#Circle.area -calls-> src/shapes.ts#Circle.scale",
		]);
	});

	test("keys each file by the hash of its content", async () => {
		const repo = createRepo({ "a.ts": MATH, "b.ts": MATH });
		unwrap(await indexRepo(repo.ports, ROOT));
		const [a, b] = snapshot(repo.db).files;
		expect(a?.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(a?.hash).toBe(b?.hash ?? "");
	});

	test("lists files through git when the root is a repository", async () => {
		const repo = createRepo(
			{ ...FILES, "dist/bundle.js": "export function x() {}\n" },
			{
				"ls-files -z --cached --others --exclude-standard":
					"src/math.ts\0src/shapes.ts\0src/index.ts\0README.md\0",
			},
		);
		unwrap(await indexRepo(repo.ports, ROOT));
		expect(snapshot(repo.db).files.map((f) => f.path)).toEqual([
			"src/index.ts",
			"src/math.ts",
			"src/shapes.ts",
		]);
	});

	test("walks the filesystem without git, skipping dependency and build dirs", async () => {
		const repo = createRepo({
			...FILES,
			"node_modules/pkg/index.js": "export function x() {}\n",
			".git/hooks/pre-commit.js": "x();\n",
			"dist/bundle.js": "export function y() {}\n",
		});
		unwrap(await indexRepo(repo.ports, ROOT));
		expect(snapshot(repo.db).files.map((f) => f.path)).toEqual([
			"src/index.ts",
			"src/math.ts",
			"src/shapes.ts",
		]);
	});

	test("a second run over an unchanged repo parses nothing and changes nothing", async () => {
		const repo = createRepo(FILES);
		const spy = parseSpy();
		unwrap(await indexRepo(repo.ports, ROOT, { parse: spy.parse }));
		expect(spy.calls()).toEqual([
			"src/index.ts",
			"src/math.ts",
			"src/shapes.ts",
		]);
		const before = dumpTables(repo.db);

		spy.reset();
		const report = unwrap(
			await indexRepo(repo.ports, ROOT, { parse: spy.parse }),
		);
		expect(spy.calls()).toEqual([]);
		expect(report.parsed).toEqual([]);
		expect(report.resolved).toEqual([]);
		expect(dumpTables(repo.db)).toEqual(before);
	});

	test("reports a grammar that fails to load as an error value", async () => {
		const repo = createRepo(FILES);
		const result = await indexRepo(repo.ports, ROOT, {
			parse: async () => ({
				ok: false,
				error: {
					kind: "grammar_load_failed",
					lang: "typescript",
					message: "boom",
				},
			}),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("parse");
	});

	test("keeps a file the parser cannot read, with no symbols", async () => {
		const repo = createRepo({ "a.ts": MATH });
		unwrap(
			await indexRepo(repo.ports, ROOT, {
				parse: async (path) => ({
					ok: false,
					error: { kind: "parse_failed", path, message: "wasm trap" },
				}),
			}),
		);
		const graph = snapshot(repo.db);
		expect(graph.files.map((f) => f.path)).toEqual(["a.ts"]);
		expect(nodeIds(graph)).toEqual(["a.ts"]);
	});

	test("reports a failing database as an error value and leaves no partial writes", async () => {
		const repo = createRepo(FILES);
		const real = createMemoryDb();
		let failNodes = true;
		const flaky: DbPort = {
			all: real.all,
			run: (sql, params) =>
				failNodes && sql.includes("INSERT INTO graph_nodes")
					? { ok: false, error: { kind: "query_failed", message: "disk full" } }
					: real.run(sql, params),
		};
		const result = await indexRepo({ ...repo.ports, db: flaky }, ROOT);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("db");
		expect(snapshot(real).files).toEqual([]);

		failNodes = false;
		unwrap(await indexRepo({ ...repo.ports, db: flaky }, ROOT));
		expect(snapshot(real).files).toHaveLength(3);
	});
});

describe("updateFiles", () => {
	test("an unchanged file is not re-parsed; its dependents are re-resolved", async () => {
		const repo = createRepo(FILES);
		const spy = parseSpy();
		unwrap(await indexRepo(repo.ports, ROOT, { parse: spy.parse }));

		await repo.write(
			"src/math.ts",
			`${MATH}\nexport function half(n: number): number {\n\treturn n / 2;\n}\n`,
		);
		spy.reset();
		const report = unwrap(
			await updateFiles(repo.ports, ROOT, ["src/math.ts", "src/shapes.ts"], {
				parse: spy.parse,
			}),
		);

		expect(spy.calls()).toEqual(["src/math.ts"]);
		expect(report.parsed).toEqual(["src/math.ts"]);
		expect(report.unchanged).toEqual(["src/shapes.ts"]);
		// index.ts and shapes.ts import math.ts, so they are re-resolved from
		// their stored facts without being parsed again.
		expect(report.resolved).toEqual([
			"src/index.ts",
			"src/math.ts",
			"src/shapes.ts",
		]);
		expect(nodeIds(snapshot(repo.db))).toContain("src/math.ts#half");
	});

	test("accepts absolute paths and ignores paths outside the root or without a grammar", async () => {
		const repo = createRepo(FILES);
		unwrap(await indexRepo(repo.ports, ROOT));
		await repo.write("src/math.ts", "export function square() {}\n");
		const report = unwrap(
			await updateFiles(repo.ports, ROOT, [
				`${ROOT}/src/math.ts`,
				"/elsewhere/x.ts",
				"../outside.ts",
				"README.md",
			]),
		);
		expect(report.parsed).toEqual(["src/math.ts"]);
		expect(nodeIds(snapshot(repo.db))).not.toContain("src/math.ts#cube");
	});

	test("a rename moves its nodes and edges without re-parsing the moved file", async () => {
		const repo = createRepo(FILES);
		const spy = parseSpy();
		unwrap(await indexRepo(repo.ports, ROOT, { parse: spy.parse }));

		await repo.remove("src/math.ts");
		await repo.write("src/arith.ts", MATH);
		await repo.write("src/shapes.ts", SHAPES.replace('"./math"', '"./arith"'));
		await repo.write("src/index.ts", INDEX.replace('"./math"', '"./arith"'));
		spy.reset();
		const report = unwrap(
			await updateFiles(
				repo.ports,
				ROOT,
				["src/math.ts", "src/arith.ts", "src/shapes.ts", "src/index.ts"],
				{ parse: spy.parse },
			),
		);

		// Same content under a new path: the stored parse is reused by hash.
		expect(spy.calls()).toEqual(["src/index.ts", "src/shapes.ts"]);
		expect(report.reused).toEqual(["src/arith.ts"]);
		expect(report.removed).toEqual(["src/math.ts"]);

		const graph = snapshot(repo.db);
		expect(nodeIds(graph).filter((id) => id.startsWith("src/math.ts"))).toEqual(
			[],
		);
		expect(edgeRows(graph)).toEqual([
			"src/arith.ts#cube -calls-> src/arith.ts#square",
			"src/index.ts -imports-> src/arith.ts",
			"src/index.ts -imports-> src/shapes.ts",
			"src/index.ts#main -calls-> src/arith.ts#cube",
			"src/index.ts#main -calls-> src/shapes.ts#Circle",
			"src/shapes.ts -imports-> src/arith.ts",
			"src/shapes.ts#Circle.area -calls-> src/arith.ts#square",
			"src/shapes.ts#Circle.area -calls-> src/shapes.ts#Circle.scale",
		]);
	});

	test("deleting a file removes its nodes and every edge that pointed at them", async () => {
		const repo = createRepo(FILES);
		unwrap(await indexRepo(repo.ports, ROOT));

		await repo.remove("src/math.ts");
		const report = unwrap(await updateFiles(repo.ports, ROOT, ["src/math.ts"]));
		expect(report.removed).toEqual(["src/math.ts"]);

		const graph = snapshot(repo.db);
		expect(graph.files.map((f) => f.path)).toEqual([
			"src/index.ts",
			"src/shapes.ts",
		]);
		expect(nodeIds(graph).some((id) => id.startsWith("src/math.ts"))).toBe(
			false,
		);
		expect(edgeRows(graph)).toEqual([
			"src/index.ts -imports-> src/shapes.ts",
			"src/index.ts#main -calls-> src/shapes.ts#Circle",
			"src/shapes.ts#Circle.area -calls-> src/shapes.ts#Circle.scale",
		]);
		// Its stored parse is pruned once no path points at that content.
		const blobs = unwrap(repo.db.all("SELECT hash FROM graph_blobs"));
		expect(blobs).toHaveLength(2);
	});

	test("adding a file resolves references that were dangling before", async () => {
		const repo = createRepo({ "src/shapes.ts": SHAPES });
		unwrap(await indexRepo(repo.ports, ROOT));
		expect(edgeRows(snapshot(repo.db))).toEqual([
			"src/shapes.ts#Circle.area -calls-> src/shapes.ts#Circle.scale",
		]);

		await repo.write("src/math.ts", MATH);
		unwrap(await updateFiles(repo.ports, ROOT, ["src/math.ts"]));
		expect(edgeRows(snapshot(repo.db))).toContain(
			"src/shapes.ts#Circle.area -calls-> src/math.ts#square",
		);
	});

	test("a Go package or Java class that appears later resolves imports that pointed nowhere", async () => {
		const repo = createRepo({
			"cmd/main.go": [
				"package main",
				"",
				'import "github.com/acme/repo/units"',
				"",
				"func main() { units.Pi() }",
				"",
			].join("\n"),
			"app/Main.java": [
				"import com.acme.Geometry;",
				"public class Main {",
				"\tpublic void run() { Geometry.square(); }",
				"}",
				"",
			].join("\n"),
		});
		unwrap(await indexRepo(repo.ports, ROOT));
		expect(edgeRows(snapshot(repo.db))).toEqual([]);

		await repo.write(
			"units/pi.go",
			"package units\n\nfunc Pi() int { return 3 }\n",
		);
		await repo.write(
			"lib/com/acme/Geometry.java",
			"public class Geometry {\n\tpublic static int square() { return 1; }\n}\n",
		);
		unwrap(
			await updateFiles(repo.ports, ROOT, [
				"units/pi.go",
				"lib/com/acme/Geometry.java",
			]),
		);
		expect(edgeRows(snapshot(repo.db))).toEqual([
			"app/Main.java -imports-> lib/com/acme/Geometry.java",
			"app/Main.java#Main.run -calls-> lib/com/acme/Geometry.java#Geometry.square",
			"cmd/main.go -imports-> units/pi.go",
			"cmd/main.go#main -calls-> units/pi.go#Pi",
		]);
	});
});
