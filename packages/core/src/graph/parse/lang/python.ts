/** Python extractor. Test detection follows pytest's and unittest's defaults. */

import {
	addCall,
	addImport,
	addRef,
	addSymbol,
	addTest,
	field,
	type Node,
	namedKids,
	type Sink,
} from "../nodes";
import type { ImportBinding } from "../types";

type Ctx = Readonly<{
	parent: string | null;
	scope: string | null;
	/** Directly inside a class body. */
	inClass: boolean;
	/** A symbol declared here is visible outside the module (if its name is public). */
	visible: boolean;
	/** Directly inside a pytest `Test*` class or a `unittest.TestCase`. */
	testClass: boolean;
}>;

const TOP: Ctx = {
	parent: null,
	scope: null,
	inClass: false,
	visible: true,
	testClass: false,
};

export function extractPython(root: Node, sink: Sink): void {
	const walk = (node: Node, ctx: Ctx): void => {
		switch (node.type) {
			case "comment":
				return;
			case "import_statement":
				importStatement(sink, node);
				return;
			case "import_from_statement":
				importFrom(sink, node);
				return;
			case "decorated_definition":
				for (const kid of namedKids(node)) walk(kid, ctx);
				return;
			case "function_definition":
				functionDef(node, ctx);
				return;
			case "class_definition":
				classDef(node, ctx);
				return;
			case "call":
				call(node, ctx);
				return;
			case "type":
				typeRefs(node, ctx);
				return;
			default:
				for (const kid of namedKids(node)) walk(kid, ctx);
		}
	};

	const functionDef = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		if (!name) return;
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: ctx.inClass ? "method" : "function",
			parent: ctx.parent,
			exported: ctx.visible && isPublic(name.text),
		});
		const isTest =
			name.text.startsWith("test") && (ctx.parent === null || ctx.testClass);
		if (isTest) {
			addTest(sink, node, {
				name: name.text,
				kind: "case",
				scope: ctx.parent,
				qualifiedName: qn,
			});
		}
		const inner: Ctx = {
			parent: qn,
			scope: qn,
			inClass: false,
			visible: false,
			testClass: false,
		};
		for (const part of ["parameters", "return_type", "body"]) {
			const kid = field(node, part);
			if (kid) walk(kid, inner);
		}
	};

	const classDef = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		if (!name) return;
		const exported = ctx.visible && isPublic(name.text);
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "class",
			parent: ctx.parent,
			exported,
		});
		const bases = field(node, "superclasses");
		const baseNames: string[] = [];
		const inner: Ctx = {
			parent: qn,
			scope: qn,
			inClass: true,
			visible: exported,
			testClass: false,
		};
		if (bases) {
			for (const base of namedKids(bases)) {
				const path = namePath(base);
				if (path !== null) {
					baseNames.push(path);
					addRef(sink, base, path, "inherit", qn);
				} else walk(base, inner);
			}
		}
		const testClass =
			(ctx.parent === null || ctx.testClass) &&
			(name.text.startsWith("Test") ||
				baseNames.some((b) => b === "TestCase" || b.endsWith(".TestCase")));
		if (testClass) {
			addTest(sink, node, {
				name: name.text,
				kind: "suite",
				scope: ctx.parent,
				qualifiedName: qn,
			});
		}
		const body = field(node, "body");
		if (body) walk(body, { ...inner, testClass });
	};

	const call = (node: Node, ctx: Ctx): void => {
		const fn = field(node, "function");
		if (fn?.type === "identifier") {
			addCall(sink, node, {
				name: fn.text,
				receiver: null,
				member: false,
				kind: "call",
				scope: ctx.scope,
			});
		} else if (fn?.type === "attribute") {
			const attr = field(fn, "attribute");
			const object = field(fn, "object");
			if (attr && object) {
				addCall(sink, node, {
					name: attr.text,
					receiver: namePath(object),
					member: true,
					kind: "call",
					scope: ctx.scope,
				});
			}
		}
		for (const kid of namedKids(node)) walk(kid, ctx);
	};

	/** Every name in an annotation is a type ref: `Optional[str]` gives `Optional` and `str`. */
	const typeRefs = (node: Node, ctx: Ctx): void => {
		const path = namePath(node);
		if (path !== null && node.type !== "type") {
			addRef(sink, node, path, "type", ctx.scope);
			return;
		}
		if (node.type === "string") return;
		for (const kid of namedKids(node)) typeRefs(kid, ctx);
	};

	for (const kid of namedKids(root)) walk(kid, TOP);
}

/** Dunder names are public; any other leading underscore is private. */
function isPublic(name: string): boolean {
	return (
		!name.startsWith("_") || (name.startsWith("__") && name.endsWith("__"))
	);
}

function namePath(node: Node): string | null {
	if (node.type === "identifier") return node.text;
	if (node.type === "attribute") {
		const object = field(node, "object");
		const attr = field(node, "attribute");
		const head = object ? namePath(object) : null;
		return head !== null && attr ? `${head}.${attr.text}` : null;
	}
	return null;
}

function importStatement(sink: Sink, node: Node): void {
	for (const kid of namedKids(node)) {
		if (kid.type === "dotted_name") {
			addImport(sink, node, {
				source: kid.text,
				names: [{ name: "*", alias: null }],
			});
		} else if (kid.type === "aliased_import") {
			const name = field(kid, "name");
			const alias = field(kid, "alias");
			if (name) {
				addImport(sink, node, {
					source: name.text,
					names: [{ name: "*", alias: alias?.text ?? null }],
				});
			}
		}
	}
}

function importFrom(sink: Sink, node: Node): void {
	const module = field(node, "module_name");
	if (!module) return;
	const names: ImportBinding[] = [];
	for (let i = 0; i < node.childCount; i++) {
		const kid = node.child(i);
		if (!kid) continue;
		if (kid.type === "wildcard_import") names.push({ name: "*", alias: null });
		else if (node.fieldNameForChild(i) !== "name") continue;
		else if (kid.type === "aliased_import") {
			const name = field(kid, "name");
			const alias = field(kid, "alias");
			if (name) names.push({ name: name.text, alias: alias?.text ?? null });
		} else names.push({ name: kid.text, alias: null });
	}
	addImport(sink, node, { source: module.text, names });
}
