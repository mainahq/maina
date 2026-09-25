import { describe, expect, test } from "bun:test";
import {
	callRows,
	fixture,
	parseFixture,
	parseSource,
	refRows,
	symbolRows,
	testRows,
} from "./helpers";

describe("parseFile — Java", () => {
	test("extracts classes, interfaces, enums, constructors and methods", async () => {
		const file = await parseFixture("Shapes.java");
		expect(file.lang).toBe("java");
		expect(file.errors).toEqual([]);
		// public/protected members of an exported type are exported; interface
		// members are implicitly public.
		expect(symbolRows(file)).toEqual([
			"interface Shape exported",
			"method Shape.area exported",
			"class Circle exported",
			"method Circle.Circle exported",
			"method Circle.area exported",
			"method Circle.scale",
			"method Circle.load exported",
			"enum Color",
			"class CircleTest",
			"method CircleTest.areaIsPositive",
			"method CircleTest.scales",
			"method CircleTest.helper",
		]);
	});

	test("extracts single-type, wildcard and static imports", async () => {
		const file = await parseFixture("Shapes.java");
		expect(file.imports.map((i) => [i.source, i.kind, i.names])).toEqual([
			["java.util", "import", [{ name: "List", alias: null }]],
			["java.util.function", "import", [{ name: "*", alias: null }]],
			["java.lang.Math", "import", [{ name: "PI", alias: null }]],
		]);
	});

	test("extracts method invocations and object creation", async () => {
		const file = await parseFixture("Shapes.java");
		expect(callRows(file)).toEqual([
			"Circle.area | Geometry.square | call",
			"Circle.area | scale | call",
			"Circle.load | Circle | new",
			"Circle.load | p.length | call",
			"Circle.load | List.of | call",
			"CircleTest.areaIsPositive | assertTrue | call",
			"CircleTest.areaIsPositive | area | call",
			"CircleTest.areaIsPositive | Circle | new",
		]);
		expect(
			file.calls.find((c) => c.callee === "Geometry.square"),
		).toMatchObject({ name: "square", member: true, receiver: "Geometry" });
		expect(file.calls.find((c) => c.callee === "scale")).toMatchObject({
			member: false,
			receiver: null,
		});
	});

	test("extracts superclass/interfaces as inherit refs and type positions as type refs", async () => {
		const file = await parseFixture("Shapes.java");
		expect(refRows(file)).toEqual([
			"inherit Circle Base",
			"inherit Circle Shape",
			"inherit Circle Comparable",
			"type Circle Circle",
			"type Circle.load List",
			"type Circle.load Circle",
			"type Circle.load String",
			"type Circle.load Circle",
		]);
	});

	test("detects JUnit test methods and their class as a suite", async () => {
		const file = await parseFixture("Shapes.java");
		expect(testRows(file)).toEqual([
			"suite CircleTest",
			"case CircleTest.areaIsPositive",
			"case CircleTest.scales",
		]);
		expect(file.tests[1]).toMatchObject({ scope: "CircleTest" });
	});

	test("test file conventions: *Test.java, *Tests.java and src/test/", async () => {
		const source = fixture("Shapes.java");
		const isTest = async (path: string) =>
			(await parseSource(path, source)).isTestFile;
		expect(await isTest("src/main/java/Shapes.java")).toBe(false);
		expect(await isTest("src/main/java/ShapesTest.java")).toBe(true);
		expect(await isTest("src/main/java/ShapesTests.java")).toBe(true);
		expect(await isTest("src/test/java/Fixtures.java")).toBe(true);
	});

	test("syntax errors give partial results instead of failing", async () => {
		const source = [
			"class A {",
			"    int good() { return work(); }",
			"    void broken( {",
			"}",
		].join("\n");
		const file = await parseSource("A.java", source);
		expect(file.errors.length).toBeGreaterThan(0);
		expect(symbolRows(file)).toContain("method A.good");
		expect(callRows(file)).toContain("A.good | work | call");
	});
});
