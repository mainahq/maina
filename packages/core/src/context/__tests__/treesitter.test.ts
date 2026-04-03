import { describe, expect, test } from "bun:test";
import {
	extractEntities,
	extractExports,
	extractImports,
	parseFile,
} from "../treesitter";

describe("extractImports", () => {
	test("parses named imports correctly", () => {
		const content = `import { Foo, Bar, Baz } from "some-module";`;
		const imports = extractImports(content);
		expect(imports).toHaveLength(1);
		expect(imports[0]?.source).toBe("some-module");
		expect(imports[0]?.specifiers).toEqual(["Foo", "Bar", "Baz"]);
		expect(imports[0]?.isDefault).toBe(false);
	});

	test("parses default imports", () => {
		const content = `import MyDefault from "./my-file";`;
		const imports = extractImports(content);
		expect(imports).toHaveLength(1);
		expect(imports[0]?.source).toBe("./my-file");
		expect(imports[0]?.specifiers).toEqual(["MyDefault"]);
		expect(imports[0]?.isDefault).toBe(true);
	});

	test("parses namespace imports (import * as X)", () => {
		const content = `import * as Utils from "../utils";`;
		const imports = extractImports(content);
		expect(imports).toHaveLength(1);
		expect(imports[0]?.source).toBe("../utils");
		expect(imports[0]?.specifiers).toEqual(["Utils"]);
		expect(imports[0]?.isDefault).toBe(false);
	});

	test("parses type imports", () => {
		const content = `import type { SomeType, AnotherType } from "types-module";`;
		const imports = extractImports(content);
		expect(imports).toHaveLength(1);
		expect(imports[0]?.source).toBe("types-module");
		expect(imports[0]?.specifiers).toEqual(["SomeType", "AnotherType"]);
		expect(imports[0]?.isDefault).toBe(false);
	});

	test("parses multiple imports", () => {
		const content = [
			`import { A } from "mod-a";`,
			`import B from "mod-b";`,
			`import type { C } from "mod-c";`,
		].join("\n");
		const imports = extractImports(content);
		expect(imports).toHaveLength(3);
		expect(imports[0]?.source).toBe("mod-a");
		expect(imports[1]?.source).toBe("mod-b");
		expect(imports[2]?.source).toBe("mod-c");
	});

	test("returns empty array when no imports", () => {
		const content = `const x = 1;`;
		const imports = extractImports(content);
		expect(imports).toHaveLength(0);
	});
});

describe("extractExports", () => {
	test("finds exported functions", () => {
		const content = [
			`export function doSomething() {}`,
			`export async function fetchData() {}`,
		].join("\n");
		const exports = extractExports(content);
		const names = exports.map((e) => e.name);
		expect(names).toContain("doSomething");
		expect(names).toContain("fetchData");
	});

	test("finds exported classes and interfaces", () => {
		const content = [
			`export class MyService {}`,
			`export interface MyInterface {}`,
		].join("\n");
		const exports = extractExports(content);
		const names = exports.map((e) => e.name);
		expect(names).toContain("MyService");
		expect(names).toContain("MyInterface");

		const classExport = exports.find((e) => e.name === "MyService");
		expect(classExport?.kind).toBe("class");

		const interfaceExport = exports.find((e) => e.name === "MyInterface");
		expect(interfaceExport?.kind).toBe("interface");
	});

	test("finds exported type aliases and const", () => {
		const content = [
			`export type MyAlias = string | number;`,
			`export const MY_CONST = 42;`,
		].join("\n");
		const exports = extractExports(content);
		const names = exports.map((e) => e.name);
		expect(names).toContain("MyAlias");
		expect(names).toContain("MY_CONST");
	});

	test("finds export default", () => {
		const content = `export default class DefaultClass {}`;
		const exports = extractExports(content);
		const defaultExport = exports.find((e) => e.name === "default");
		expect(defaultExport).toBeDefined();
	});

	test("finds named re-exports: export { X, Y }", () => {
		const content = `export { Foo, Bar } from "./somewhere";`;
		const exports = extractExports(content);
		const names = exports.map((e) => e.name);
		expect(names).toContain("Foo");
		expect(names).toContain("Bar");
	});

	test("returns empty array when no exports", () => {
		const content = `const x = 1;`;
		const exports = extractExports(content);
		expect(exports).toHaveLength(0);
	});
});

describe("extractEntities", () => {
	test("finds function declarations with line numbers", () => {
		const content = [
			``,
			`function greet(name: string): string {`,
			`  return "hello " + name;`,
			`}`,
		].join("\n");
		const entities = extractEntities(content);
		const fn = entities.find((e) => e.name === "greet");
		expect(fn).toBeDefined();
		expect(fn?.kind).toBe("function");
		expect(fn?.startLine).toBe(2);
	});

	test("finds class declarations", () => {
		const content = [`class MyClass {`, `  constructor() {}`, `}`].join("\n");
		const entities = extractEntities(content);
		const cls = entities.find((e) => e.name === "MyClass");
		expect(cls).toBeDefined();
		expect(cls?.kind).toBe("class");
		expect(cls?.startLine).toBe(1);
	});

	test("finds interface declarations", () => {
		const content = `interface Shape {\n  area(): number;\n}`;
		const entities = extractEntities(content);
		const iface = entities.find((e) => e.name === "Shape");
		expect(iface).toBeDefined();
		expect(iface?.kind).toBe("interface");
	});

	test("finds type alias declarations", () => {
		const content = `type ID = string | number;`;
		const entities = extractEntities(content);
		const typeAlias = entities.find((e) => e.name === "ID");
		expect(typeAlias).toBeDefined();
		expect(typeAlias?.kind).toBe("type");
	});

	test("finds top-level const declarations", () => {
		const content = `const MAX_SIZE = 100;`;
		const entities = extractEntities(content);
		const variable = entities.find((e) => e.name === "MAX_SIZE");
		expect(variable).toBeDefined();
		expect(variable?.kind).toBe("variable");
	});

	test("endLine is set (at least equal to startLine)", () => {
		const content = `function hello() {}`;
		const entities = extractEntities(content);
		const fn = entities.find((e) => e.name === "hello");
		expect(fn).toBeDefined();
		expect(fn?.endLine ?? 0).toBeGreaterThanOrEqual(fn?.startLine ?? 0);
	});

	test("returns empty array when no entities", () => {
		const content = `// just a comment`;
		const entities = extractEntities(content);
		expect(entities).toHaveLength(0);
	});
});

describe("parseFile", () => {
	test("reads an actual TS file and returns imports/exports/entities", async () => {
		const filePath = `${process.cwd()}/packages/core/src/git/index.ts`;
		const result = await parseFile(filePath);

		expect(result).toHaveProperty("imports");
		expect(result).toHaveProperty("exports");
		expect(result).toHaveProperty("entities");

		expect(Array.isArray(result.imports)).toBe(true);
		expect(Array.isArray(result.exports)).toBe(true);
		expect(Array.isArray(result.entities)).toBe(true);

		// git/index.ts exports several functions
		const exportNames = result.exports.map((e) => e.name);
		expect(exportNames).toContain("getCurrentBranch");
		expect(exportNames).toContain("getRepoRoot");
		expect(exportNames).toContain("getRecentCommits");

		// git/index.ts has function/interface entities
		const entityNames = result.entities.map((e) => e.name);
		expect(entityNames).toContain("Commit");
		expect(
			entityNames.some((n) =>
				["exec", "getCurrentBranch", "getRepoRoot"].includes(n),
			),
		).toBe(true);
	});

	test("returns empty arrays for a file with no imports/exports/entities", async () => {
		// Write a minimal temp file and parse it
		const tmpPath = "/tmp/maina-test-empty.ts";
		await Bun.write(tmpPath, "// empty file\n");
		const result = await parseFile(tmpPath);
		expect(result.imports).toHaveLength(0);
		expect(result.exports).toHaveLength(0);
		expect(result.entities).toHaveLength(0);
	});
});
