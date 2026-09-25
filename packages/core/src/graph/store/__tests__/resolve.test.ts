import { describe, expect, test } from "bun:test";
import { indexRepo } from "../index";
import { createRepo, edgeRows, ROOT, snapshot, unwrap } from "./helpers";

async function edgesOf(
	files: Readonly<Record<string, string>>,
): Promise<readonly string[]> {
	const repo = createRepo(files);
	unwrap(await indexRepo(repo.ports, ROOT));
	return edgeRows(snapshot(repo.db));
}

describe("TypeScript and JavaScript", () => {
	test("resolves directory indexes, ESM .js specifiers, namespaces and aliases", async () => {
		const edges = await edgesOf({
			"src/lib/index.ts": "export function helper(): number { return 1; }\n",
			"src/util.ts": "export function fmt(s: string): string { return s; }\n",
			"src/app.ts": [
				'import { helper as h } from "./lib";',
				'import * as util from "./util.js";',
				"export function run(): string { return util.fmt(String(h())); }",
				"",
			].join("\n"),
		});
		expect(edges).toEqual([
			"src/app.ts -imports-> src/lib/index.ts",
			"src/app.ts -imports-> src/util.ts",
			"src/app.ts#run -calls-> src/lib/index.ts#helper",
			"src/app.ts#run -calls-> src/util.ts#fmt",
		]);
	});

	test("links type references and inheritance, but not unexported symbols or packages", async () => {
		const edges = await edgesOf({
			"src/base.ts": [
				"export class Base {}",
				"export interface Shape { area(): number }",
				"function hidden(): void {}",
				"",
			].join("\n"),
			"src/circle.ts": [
				'import { Base, Shape, hidden } from "./base";',
				'import { readFile } from "node:fs";',
				"export class Circle extends Base implements Shape {",
				"\tarea(): number { hidden(); readFile; return 1; }",
				"}",
				"",
			].join("\n"),
		});
		expect(edges).toEqual([
			"src/circle.ts -imports-> src/base.ts",
			"src/circle.ts#Circle -inherits-> src/base.ts#Base",
			"src/circle.ts#Circle -inherits-> src/base.ts#Shape",
		]);
	});

	test("edges from a test case point at the code it exercises", async () => {
		const edges = await edgesOf({
			"src/math.ts":
				"export function square(n: number): number { return n * n; }\n",
			"src/math.test.ts": [
				'import { square } from "./math";',
				'describe("square", () => { test("squares", () => { square(2); }); });',
				"",
			].join("\n"),
		});
		expect(edges).toContain(
			"src/math.test.ts#square > squares -calls-> src/math.ts#square",
		);
	});
});

describe("Python", () => {
	test("resolves relative, absolute, submodule and wildcard imports", async () => {
		const edges = await edgesOf({
			"app/pkg/__init__.py": "",
			"app/pkg/base.py": "class Base:\n    pass\n",
			"app/pkg/util.py": "def fmt(s):\n    return s\n",
			"app/pkg/star.py": "def starred():\n    return 1\n",
			"app/pkg/shapes.py": [
				"from .base import Base",
				"from . import util",
				"from .star import *",
				"import pkg.util as u",
				"",
				"class Circle(Base):",
				"    def area(self):",
				"        return util.fmt(u.fmt(starred())) + self.size()",
				"    def size(self):",
				"        return 1",
				"",
			].join("\n"),
		});
		expect(edges).toEqual([
			"app/pkg/shapes.py -imports-> app/pkg/base.py",
			"app/pkg/shapes.py -imports-> app/pkg/star.py",
			"app/pkg/shapes.py -imports-> app/pkg/util.py",
			"app/pkg/shapes.py#Circle -inherits-> app/pkg/base.py#Base",
			"app/pkg/shapes.py#Circle.area -calls-> app/pkg/shapes.py#Circle.size",
			"app/pkg/shapes.py#Circle.area -calls-> app/pkg/star.py#starred",
			"app/pkg/shapes.py#Circle.area -calls-> app/pkg/util.py#fmt",
		]);
	});
});

describe("Go", () => {
	test("resolves module imports by directory and same-package calls across files", async () => {
		const edges = await edgesOf({
			"units/units.go": "package units\n\nfunc Pi() float64 { return 3.14 }\n",
			"geo/square.go":
				"package geo\n\nfunc square(x float64) float64 { return x * x }\n",
			"geo/circle.go": [
				"package geo",
				"",
				'import (\n\t"fmt"\n\tu "github.com/acme/repo/units"\n)',
				"",
				"type Circle struct{ R float64 }",
				"",
				"func (c Circle) Area() float64 { fmt.Println(); return square(c.R) * u.Pi() }",
				"",
			].join("\n"),
		});
		expect(edges).toEqual([
			"geo/circle.go -imports-> units/units.go",
			"geo/circle.go#Circle.Area -calls-> geo/square.go#square",
			"geo/circle.go#Circle.Area -calls-> units/units.go#Pi",
		]);
	});
});

describe("Java", () => {
	test("resolves class imports, static members and same-package classes", async () => {
		const edges = await edgesOf({
			"src/main/java/com/acme/util/Geometry.java": [
				"package com.acme.util;",
				"public class Geometry {",
				"\tpublic static double square(double x) { return x * x; }",
				"}",
				"",
			].join("\n"),
			"src/main/java/com/acme/shapes/Base.java": [
				"package com.acme.shapes;",
				"public class Base {}",
				"",
			].join("\n"),
			"src/main/java/com/acme/shapes/Circle.java": [
				"package com.acme.shapes;",
				"import com.acme.util.Geometry;",
				"import java.util.List;",
				"public class Circle extends Base {",
				"\tpublic double area() { return Geometry.square(2); }",
				"}",
				"",
			].join("\n"),
		});
		expect(edges).toEqual([
			"src/main/java/com/acme/shapes/Circle.java -imports-> src/main/java/com/acme/util/Geometry.java",
			"src/main/java/com/acme/shapes/Circle.java#Circle -inherits-> src/main/java/com/acme/shapes/Base.java#Base",
			"src/main/java/com/acme/shapes/Circle.java#Circle.area -calls-> src/main/java/com/acme/util/Geometry.java#Geometry.square",
		]);
	});
});

describe("Rust", () => {
	test("resolves crate, self and super paths to module files", async () => {
		const edges = await edgesOf({
			"src/lib.rs": "pub mod geo;\npub mod units;\n",
			"src/units.rs": "pub fn pi() -> f64 { 3.14 }\n",
			"src/geo/mod.rs":
				"pub mod circle;\npub fn square(x: f64) -> f64 { x * x }\n",
			"src/geo/circle.rs": [
				"use crate::units::pi;",
				"use super::square;",
				"pub struct Circle { r: f64 }",
				"impl Circle {",
				"\tpub fn new(r: f64) -> Self { Circle { r } }",
				"\tpub fn area(&self) -> f64 { square(self.r) * pi() }",
				"}",
				"pub fn unit() -> Circle { Circle::new(1.0) }",
				"",
			].join("\n"),
		});
		expect(edges).toEqual([
			"src/geo/circle.rs -imports-> src/geo/mod.rs",
			"src/geo/circle.rs -imports-> src/units.rs",
			"src/geo/circle.rs#Circle.area -calls-> src/geo/mod.rs#square",
			"src/geo/circle.rs#Circle.area -calls-> src/units.rs#pi",
			"src/geo/circle.rs#Circle.new -references-> src/geo/circle.rs#Circle",
			"src/geo/circle.rs#unit -calls-> src/geo/circle.rs#Circle.new",
			"src/geo/circle.rs#unit -references-> src/geo/circle.rs#Circle",
		]);
	});
});
