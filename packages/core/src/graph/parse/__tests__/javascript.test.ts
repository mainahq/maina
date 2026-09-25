import { describe, expect, test } from "bun:test";
import {
	callRows,
	parseFixture,
	parseSource,
	refRows,
	symbolRows,
} from "./helpers";

describe("parseFile — TSX", () => {
	test("extracts components, JSX element calls and generic heritage", async () => {
		const file = await parseFixture("widget.tsx");
		expect(file.lang).toBe("tsx");
		expect(file.errors).toEqual([]);
		expect(symbolRows(file)).toEqual([
			"type Props",
			"function Counter exported",
			"function Badge exported",
			"class Panel exported",
			"method Panel.render exported",
		]);
		expect(file.imports.map((i) => [i.source, i.names])).toEqual([
			[
				"react",
				[
					{ name: "default", alias: "React" },
					{ name: "useState", alias: null },
				],
			],
			["./button", [{ name: "Button", alias: null }]],
		]);
		// Capitalised JSX elements are component uses; intrinsic tags are not.
		expect(callRows(file)).toEqual([
			"Counter | useState | call",
			"Counter | Button | jsx",
			"Counter | setCount | call",
		]);
		expect(refRows(file)).toEqual([
			"type Counter Props",
			"type Badge Props",
			"inherit Panel React.Component",
			"type Panel Props",
		]);
	});
});

describe("parseFile — JavaScript", () => {
	test("extracts functions, classes, methods and arrow-function fields", async () => {
		const file = await parseFixture("server.js");
		expect(file.lang).toBe("javascript");
		expect(file.errors).toEqual([]);
		expect(symbolRows(file)).toEqual([
			"function start exported",
			"class Store exported",
			"method Store.add exported",
			"method Store.handle exported",
			"function main exported",
		]);
	});

	test("extracts ESM imports, re-exports and require() calls", async () => {
		const file = await parseFixture("server.js");
		expect(file.imports.map((i) => [i.source, i.kind, i.names])).toEqual([
			["express", "import", [{ name: "default", alias: "express" }]],
			["./log.js", "import", [{ name: "log", alias: null }]],
			["./routes.js", "reexport", [{ name: "route", alias: null }]],
			["node:fs", "import", []],
		]);
	});

	test("extracts calls including chained member receivers", async () => {
		const file = await parseFixture("server.js");
		expect(callRows(file)).toEqual([
			"- | require | call",
			"start | express | call",
			"start | app.listen | call",
			"start | log | call",
			"Store.add | this.items.push | call",
			"Store.add | fs.writeFileSync | call",
			"Store.add | JSON.stringify | call",
			"Store.handle | this.add | call",
			"main | start | call",
		]);
		expect(
			file.calls.find((c) => c.callee === "this.items.push"),
		).toMatchObject({ name: "push", receiver: "this.items", member: true });
	});

	test("a receiver that is not a plain name path is recorded as null", async () => {
		const file = await parseSource(
			"chain.js",
			"fetch(url).then(parse).catch(report);",
		);
		expect(
			file.calls.map((c) => [c.name, c.callee, c.member, c.receiver]),
		).toEqual([
			["catch", "catch", true, null],
			["then", "then", true, null],
			["fetch", "fetch", false, null],
		]);
	});

	test(".jsx files use the JavaScript grammar, which parses JSX", async () => {
		const file = await parseSource(
			"app.jsx",
			"export const App = () => <Layout><Nav /></Layout>;",
		);
		expect(file.lang).toBe("javascript");
		expect(file.errors).toEqual([]);
		expect(callRows(file)).toEqual(["App | Layout | jsx", "App | Nav | jsx"]);
	});

	test("syntax errors give partial results instead of failing", async () => {
		const file = await parseSource(
			"broken.js",
			"function good() { return work(); }\nconst x = {{{;\nfunction later() {}",
		);
		expect(file.errors.length).toBeGreaterThan(0);
		expect(symbolRows(file)).toContain("function good");
		expect(callRows(file)).toContain("good | work | call");
	});
});
