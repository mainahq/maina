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

describe("parseFile — Python", () => {
	test("extracts functions, classes and methods (decorated ones too)", async () => {
		const file = await parseFixture("shapes.py");
		expect(file.lang).toBe("python");
		expect(file.errors).toEqual([]);
		expect(symbolRows(file)).toEqual([
			"function greet exported",
			"function _private",
			"class Circle exported",
			"method Circle.__init__ exported",
			"method Circle.area exported",
			"method Circle.scale exported",
			"function square exported",
			"function load exported",
			"function test_square exported",
			"class TestCircle exported",
			"method TestCircle.test_area exported",
			"method TestCircle.helper exported",
		]);
	});

	test("extracts import, aliased, relative and wildcard imports", async () => {
		const file = await parseFixture("shapes.py");
		expect(file.imports.map((i) => [i.source, i.kind, i.names])).toEqual([
			["os", "import", [{ name: "*", alias: null }]],
			["os.path", "import", [{ name: "*", alias: "osp" }]],
			[
				"typing",
				"import",
				[
					{ name: "List", alias: null },
					{ name: "Optional", alias: null },
				],
			],
			[
				".base",
				"import",
				[
					{ name: "Base", alias: null },
					{ name: "Shape", alias: "S" },
				],
			],
			[".", "import", [{ name: "util", alias: null }]],
			[".star", "import", [{ name: "*", alias: null }]],
		]);
	});

	test("extracts plain and attribute calls with their scope", async () => {
		const file = await parseFixture("shapes.py");
		expect(callRows(file)).toEqual([
			"greet | util.format | call",
			"greet | name.strip | call",
			"Circle.area | self.scale | call",
			"Circle.area | square | call",
			"load | read | call",
			"load | open | call",
			"load | osp.join | call",
			"load | Circle | call",
			"load | len | call",
			"test_square | square | call",
			"TestCircle.test_area | Circle | call",
		]);
	});

	test("extracts base classes as inherit refs and annotations as type refs", async () => {
		const file = await parseFixture("shapes.py");
		const rows = refRows(file);
		expect(rows.filter((r) => r.startsWith("inherit"))).toEqual([
			"inherit Circle Base",
			"inherit Circle S",
		]);
		expect(rows.filter((r) => r.includes(" load "))).toEqual([
			"type load Optional",
			"type load str",
			"type load List",
			"type load Circle",
		]);
	});

	test("detects pytest functions and Test classes", async () => {
		const file = await parseFixture("shapes.py");
		expect(testRows(file)).toEqual([
			"case test_square",
			"suite TestCircle",
			"case TestCircle.test_area",
		]);
	});

	test("test file conventions: test_*.py and *_test.py", async () => {
		const source = fixture("shapes.py");
		expect((await parseSource("pkg/test_shapes.py", source)).isTestFile).toBe(
			true,
		);
		expect((await parseSource("pkg/shapes_test.py", source)).isTestFile).toBe(
			true,
		);
		expect((await parseSource("pkg/shapes.py", source)).isTestFile).toBe(false);
	});

	test("syntax errors give partial results instead of failing", async () => {
		const source = [
			"def good():",
			"    return work()",
			"",
			"def broken(:",
			"    pass",
			"",
			"class After:",
			"    pass",
		].join("\n");
		const file = await parseSource("broken.py", source);
		expect(file.errors.length).toBeGreaterThan(0);
		expect(symbolRows(file)).toContain("function good exported");
		expect(callRows(file)).toContain("good | work | call");
	});
});
