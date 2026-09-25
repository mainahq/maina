import { describe, expect, test } from "bun:test";
import {
	callRows,
	parseFixture,
	parseSource,
	refRows,
	symbolRows,
	testRows,
} from "./helpers";

describe("parseFile — TypeScript", () => {
	test("extracts functions, arrow functions, classes, methods and type declarations", async () => {
		const file = await parseFixture("shapes.ts");
		expect(file.lang).toBe("typescript");
		expect(file.errors).toEqual([]);
		expect(symbolRows(file)).toEqual([
			"interface Named exported",
			"type Radius exported",
			"enum Color exported",
			"function greet exported",
			"function area exported",
			"function square",
			"class Circle exported",
			"method Circle.constructor exported",
			"method Circle.area exported",
			"method Circle.scale",
			"class Solid exported",
			"method Solid.volume exported",
			"function load exported",
		]);
		const areaMethod = file.symbols.find(
			(s) => s.qualifiedName === "Circle.area",
		);
		expect(areaMethod).toEqual({
			name: "area",
			kind: "method",
			parent: "Circle",
			qualifiedName: "Circle.area",
			exported: true,
			span: { startLine: 37, startColumn: 1, endLine: 39, endColumn: 2 },
		});
	});

	test("extracts imports and re-exports with their bindings", async () => {
		const file = await parseFixture("shapes.ts");
		expect(
			file.imports.map(({ source, names, kind, typeOnly }) => ({
				source,
				names,
				kind,
				typeOnly,
			})),
		).toEqual([
			{
				source: "node:fs/promises",
				names: [{ name: "readFile", alias: null }],
				kind: "import",
				typeOnly: false,
			},
			{
				source: "node:path",
				names: [{ name: "*", alias: "path" }],
				kind: "import",
				typeOnly: false,
			},
			{
				source: "./base",
				names: [
					{ name: "default", alias: "Base" },
					{ name: "Shape", alias: null },
					{ name: "format", alias: "fmt" },
				],
				kind: "import",
				typeOnly: false,
			},
			{
				source: "./ids",
				names: [{ name: "Id", alias: null }],
				kind: "import",
				typeOnly: true,
			},
			{ source: "./polyfill", names: [], kind: "import", typeOnly: false },
			{
				source: "./helper",
				names: [{ name: "helper", alias: null }],
				kind: "reexport",
				typeOnly: false,
			},
			{
				source: "./legacy",
				names: [
					{ name: "default", alias: "Legacy" },
					{ name: "util", alias: null },
				],
				kind: "reexport",
				typeOnly: false,
			},
			{
				source: "./all",
				names: [{ name: "*", alias: null }],
				kind: "reexport",
				typeOnly: false,
			},
			{
				source: "./geometry",
				names: [{ name: "*", alias: "geometry" }],
				kind: "reexport",
				typeOnly: false,
			},
		]);
		expect(file.imports[0]?.span).toEqual({
			startLine: 1,
			startColumn: 0,
			endLine: 1,
			endColumn: 44,
		});
	});

	test("extracts plain, member and constructor calls with their enclosing scope", async () => {
		const file = await parseFixture("shapes.ts");
		expect(callRows(file)).toEqual([
			"greet | fmt | call",
			"area | square | call",
			"Circle.area | this.scale | call",
			"Circle.area | square | call",
			"load | readFile | call",
			"load | path.join | call",
			"load | Circle | new",
		]);
		const join = file.calls.find((c) => c.callee === "path.join");
		expect(join).toMatchObject({
			name: "join",
			member: true,
			receiver: "path",
			kind: "call",
			scope: "load",
		});
		const plain = file.calls.find((c) => c.callee === "fmt");
		expect(plain).toMatchObject({ name: "fmt", member: false, receiver: null });
	});

	test("extracts type and heritage references but not declaration names", async () => {
		const file = await parseFixture("shapes.ts");
		expect(refRows(file)).toEqual([
			"type greet Named",
			"type area Radius",
			"inherit Circle Base",
			"inherit Circle Shape",
			"type Circle.constructor Radius",
			"type load Promise",
			"type load Circle",
		]);
	});

	test("class decorators are calls; class and interface type-parameter constraints are refs", async () => {
		const file = await parseSource(
			"widget.ts",
			[
				'@Component({ selector: make("x") })',
				"export class Widget<T extends Base> {",
				"\t@Input() name = 1;",
				"}",
				"@Tag() class Plain {}",
				"interface Keyed<K extends Key> {}",
			].join("\n"),
		);
		expect(callRows(file)).toEqual([
			"- | Component | call",
			"- | make | call",
			"Widget | Input | call",
			"- | Tag | call",
		]);
		expect(refRows(file)).toEqual(["type Widget Base", "type Keyed Key"]);
	});

	test("a plain module has no tests and is not a test file", async () => {
		const file = await parseFixture("shapes.ts");
		expect(file.tests).toEqual([]);
		expect(file.isTestFile).toBe(false);
	});

	test("detects describe/test/it blocks, including .skip/.only/.each", async () => {
		const file = await parseFixture("shapes.test.ts");
		expect(file.isTestFile).toBe(true);
		expect(testRows(file)).toEqual([
			"suite greet",
			"case greet > formats the name",
			"case greet > is skipped",
			"case greet > case %i",
			"suite focused",
			"case focused > runs",
		]);
		expect(file.tests[1]).toMatchObject({
			name: "formats the name",
			scope: "greet",
		});
		// Calls inside a test carry the test as their scope, so the graph can
		// link a test to the code it exercises.
		expect(callRows(file)).toContain("greet > formats the name | greet | call");
		expect(callRows(file)).toContain("greet > case %i | Circle | new");
	});

	test("syntax errors give partial results instead of failing", async () => {
		const source = [
			"export function ok() {",
			"\treturn helper();",
			"}",
			"",
			"function broken( {",
			"",
			"class After {",
			"\tm() {}",
			"}",
		].join("\n");
		const file = await parseSource("broken.ts", source);
		expect(file.errors.length).toBeGreaterThan(0);
		expect(file.errors[0]?.span.startLine).toBeGreaterThanOrEqual(5);
		expect(symbolRows(file)).toContain("function ok exported");
		expect(callRows(file)).toContain("ok | helper | call");
	});
});
