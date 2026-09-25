import { describe, expect, test } from "bun:test";
import {
	callRows,
	parseFixture,
	parseSource,
	refRows,
	symbolRows,
	testRows,
} from "./helpers";

describe("parseFile — Rust", () => {
	test("extracts traits, structs, enums, impl methods, functions and modules", async () => {
		const file = await parseFixture("shapes.rs");
		expect(file.lang).toBe("rust");
		expect(file.errors).toEqual([]);
		// `pub` means exported; trait-impl methods follow the trait, so they are
		// exported; items inside a module are qualified by the module name.
		expect(symbolRows(file)).toEqual([
			"trait Shape exported",
			"method Shape.area exported",
			"struct Circle exported",
			"enum Color exported",
			"method Circle.new exported",
			"method Circle.scale",
			"method Circle.area exported",
			"function square",
			"function load exported",
			"module tests",
			"function tests.area_is_positive",
			"function tests.helper",
		]);
	});

	test("extracts use declarations, grouped by path, and pub use as re-exports", async () => {
		const file = await parseFixture("shapes.rs");
		expect(file.imports.map((i) => [i.source, i.kind, i.names])).toEqual([
			["std::collections", "import", [{ name: "HashMap", alias: null }]],
			[
				"std::io",
				"import",
				[
					{ name: "self", alias: null },
					{ name: "Read", alias: "R" },
				],
			],
			["crate::units", "import", [{ name: "*", alias: null }]],
			[
				"crate::geo",
				"reexport",
				[
					{ name: "Point", alias: null },
					{ name: "Line", alias: null },
				],
			],
			["super", "import", [{ name: "*", alias: null }]],
		]);
	});

	test("extracts calls, path calls, method calls and macros, including calls inside macro arguments", async () => {
		const file = await parseFixture("shapes.rs");
		expect(callRows(file)).toEqual([
			"Circle.area | square | call",
			"Circle.area | self.scale | call",
			"load | Circle::new | call",
			"load | println | macro",
			"load | c.area | call",
			"load | Ok | call",
			"tests.area_is_positive | assert | macro",
			"tests.area_is_positive | Circle::new | call",
			"tests.area_is_positive | area | call",
		]);
		expect(file.calls.find((c) => c.callee === "Circle::new")).toMatchObject({
			name: "new",
			member: true,
			receiver: "Circle",
		});
	});

	test("extracts trait impls as inherit refs and type positions as type refs", async () => {
		const file = await parseFixture("shapes.rs");
		expect(refRows(file)).toEqual([
			"type Circle.new Circle",
			"inherit Circle Shape",
			"type load HashMap",
			"type load String",
			"type load Circle",
			"type load io::Result",
			"type load Circle",
		]);
	});

	test("detects #[test] functions inside #[cfg(test)] modules", async () => {
		const file = await parseFixture("shapes.rs");
		expect(file.isTestFile).toBe(false);
		expect(testRows(file)).toEqual([
			"suite tests",
			"case tests.area_is_positive",
		]);
		expect(file.tests[1]).toMatchObject({
			name: "area_is_positive",
			scope: "tests",
		});
	});

	test("generic bounds and where clauses are type refs; the parameters are not", async () => {
		const file = await parseSource(
			"bounds.rs",
			[
				"struct Boxed<T: Base> where T: Other { v: T }",
				"impl<T: Show> Trait for Boxed<T> where T: Extra {}",
				"fn f<U: Bound>(u: U) where U: Also {}",
			].join("\n"),
		);
		expect(refRows(file)).toEqual([
			"type Boxed Base",
			"type Boxed Other",
			"type Boxed Show",
			"type Boxed Extra",
			"inherit Boxed Trait",
			"type f Bound",
			"type f Also",
		]);
	});

	test("comments between a test attribute and its function do not hide the test", async () => {
		const file = await parseSource(
			"lib.rs",
			"#[test]\n// explains the case\n/* and more */\nfn works() {}",
		);
		expect(testRows(file)).toEqual(["case works"]);
	});

	test("integration tests under tests/ are test files", async () => {
		const file = await parseSource(
			"crates/geo/tests/area.rs",
			"#[tokio::test]\nasync fn works() {}",
		);
		expect(file.isTestFile).toBe(true);
		expect(testRows(file)).toEqual(["case works"]);
	});

	test("syntax errors give partial results instead of failing", async () => {
		const source = [
			"pub fn good() -> u8 { work() }",
			"",
			"fn broken( {",
			"",
			"struct After;",
		].join("\n");
		const file = await parseSource("broken.rs", source);
		expect(file.errors.length).toBeGreaterThan(0);
		expect(symbolRows(file)).toContain("function good exported");
		expect(callRows(file)).toContain("good | work | call");
	});
});
