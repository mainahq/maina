import { describe, expect, test } from "bun:test";
import {
	callRows,
	parseFixture,
	parseSource,
	refRows,
	symbolRows,
	testRows,
} from "./helpers";

describe("parseFile — Go", () => {
	test("extracts functions, receiver methods, structs, interfaces and type aliases", async () => {
		const file = await parseFixture("shapes.go");
		expect(file.lang).toBe("go");
		expect(file.errors).toEqual([]);
		// Exported means capitalised; methods hang off their receiver type,
		// with or without a pointer.
		expect(symbolRows(file)).toEqual([
			"interface Shape exported",
			"method Shape.Area exported",
			"struct Circle exported",
			"type Radius exported",
			"function NewCircle exported",
			"method Circle.Area exported",
			"method Circle.scale",
			"function square",
			"function Describe exported",
		]);
		expect(file.symbols.find((s) => s.qualifiedName === "Circle.Area")).toEqual(
			{
				name: "Area",
				kind: "method",
				parent: "Circle",
				qualifiedName: "Circle.Area",
				exported: true,
				span: { startLine: 24, startColumn: 0, endLine: 26, endColumn: 1 },
			},
		);
	});

	test("extracts one import per spec with aliases; blank imports bind nothing", async () => {
		const file = await parseFixture("shapes.go");
		expect(file.imports.map((i) => [i.source, i.kind, i.names])).toEqual([
			["fmt", "import", [{ name: "*", alias: null }]],
			["math", "import", [{ name: "*", alias: "m" }]],
			["embed", "import", []],
			["github.com/acme/geo/units", "import", [{ name: "*", alias: null }]],
		]);
	});

	test("extracts plain and selector calls with their scope", async () => {
		const file = await parseFixture("shapes.go");
		expect(callRows(file)).toEqual([
			"NewCircle | units.Length | call",
			"Circle.Area | square | call",
			"Circle.Area | c.scale | call",
			"Circle.scale | float64 | call",
			"Describe | fmt.Sprintf | call",
			"Describe | s.Area | call",
		]);
		expect(file.calls.find((c) => c.callee === "c.scale")).toMatchObject({
			name: "scale",
			member: true,
			receiver: "c",
		});
	});

	test("extracts type references, skipping predeclared types and receivers", async () => {
		const file = await parseFixture("shapes.go");
		expect(refRows(file)).toEqual([
			"type Circle units.Length",
			"type NewCircle Circle",
			"type NewCircle Circle",
			"type Describe Shape",
		]);
	});

	test("type parameters, including a generic receiver's, are not type refs", async () => {
		const file = await parseSource(
			"list.go",
			[
				"package list",
				"type List[T any] struct { items []T; Base }",
				"func Map[T, U any](xs []T, f func(T) U) []U { return nil }",
				"func (l *List[T]) Push(x T) Node { return Node{} }",
			].join("\n"),
		);
		expect(symbolRows(file)).toContain("method List.Push exported");
		expect(refRows(file)).toEqual([
			"inherit List Base",
			"type List.Push Node",
			"type List.Push Node",
		]);
	});

	test("generic type arguments are type refs; only interface embeds are inherit refs", async () => {
		const file = await parseSource(
			"generic.go",
			[
				"package p",
				"type R interface { io.Reader; ~int | Num; Closer }",
				"var l List[Item]",
				"func f(p Pair[string, Bar]) *Box[int] { return nil }",
			].join("\n"),
		);
		expect(refRows(file)).toEqual([
			"inherit R io.Reader",
			"type R Num",
			"inherit R Closer",
			"type - List",
			"type - Item",
			"type f Pair",
			"type f Bar",
			"type f Box",
		]);
	});

	test("explicitly instantiated generic functions are calls", async () => {
		const file = await parseSource(
			"calls.go",
			[
				"package p",
				"func f() {",
				"\tNew[Item](x)",
				"\tpkg.Map[int](nil)",
				"\tMapKV[int, Val](xs, g)",
				"\tF[int](a, b)",
				"\tm.Do[T]()",
				"}",
			].join("\n"),
		);
		expect(callRows(file)).toEqual([
			"f | New | call",
			"f | pkg.Map | call",
			"f | MapKV | call",
			"f | F | call",
			"f | m.Do | call",
		]);
		expect(refRows(file)).toEqual(["type f Item", "type f Val"]);
	});

	test("detects Test/Benchmark functions and the _test.go convention", async () => {
		const plain = await parseFixture("shapes.go");
		expect(plain.isTestFile).toBe(false);
		expect(plain.tests).toEqual([]);

		const file = await parseFixture("shapes_test.go");
		expect(file.isTestFile).toBe(true);
		expect(testRows(file)).toEqual(["case TestArea", "case BenchmarkArea"]);
		expect(callRows(file)).toEqual([
			"TestArea | NewCircle | call",
			"TestArea | c.Area | call",
			"TestArea | t.Fatal | call",
			"BenchmarkArea | Area | call",
			"BenchmarkArea | NewCircle | call",
		]);
	});

	test("syntax errors give partial results instead of failing", async () => {
		const source = [
			"package p",
			"",
			"func Good() int { return work() }",
			"",
			"func broken( {",
			"",
			"func Later() {}",
		].join("\n");
		const file = await parseSource("broken.go", source);
		expect(file.errors.length).toBeGreaterThan(0);
		expect(symbolRows(file)).toContain("function Good exported");
		expect(callRows(file)).toContain("Good | work | call");
	});
});
