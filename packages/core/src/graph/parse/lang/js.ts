/**
 * TypeScript, TSX and JavaScript (with JSX) extractor. The three grammars
 * share node names for everything read here; TS-only nodes simply never
 * appear in a JavaScript tree.
 */

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
	typeParamNames,
	union,
} from "../nodes";
import {
	collectLocalExports,
	importStatement,
	namePath,
	reexportStatement,
	stringValue,
	testKind,
} from "./js-modules";

type Ctx = Readonly<{
	/** Qualified name of the enclosing symbol. */
	parent: string | null;
	/** Enclosing symbol or test: what calls and refs are attributed to. */
	scope: string | null;
	/** Qualified name of the enclosing describe/test block. */
	suite: string | null;
	/** Inside a class body: whether that class is exported. */
	classExported: boolean | null;
	typeParams: ReadonlySet<string>;
}>;

const TOP: Ctx = {
	parent: null,
	scope: null,
	suite: null,
	classExported: null,
	typeParams: new Set(),
};

const FUNCTION_VALUES = new Set([
	"arrow_function",
	"function_expression",
	"function",
	"generator_function",
]);

export function extractJs(root: Node, sink: Sink): void {
	const localExports = collectLocalExports(root);
	const walker = makeWalker(sink, localExports);
	walker.children(root, TOP);
}

function makeWalker(sink: Sink, localExports: ReadonlySet<string>) {
	const isExported = (name: string, ctx: Ctx, explicit: boolean): boolean =>
		explicit || (ctx.parent === null && localExports.has(name));

	function children(node: Node, ctx: Ctx): void {
		for (const kid of namedKids(node)) walk(kid, ctx, false);
	}

	function walkField(node: Node, name: string, ctx: Ctx): void {
		const kid = field(node, name);
		if (kid) walk(kid, ctx, false);
	}

	/** Walks everything except the listed fields (declaration names, heritage). */
	function childrenExcept(
		node: Node,
		ctx: Ctx,
		skip: ReadonlySet<string>,
	): void {
		for (let i = 0; i < node.childCount; i++) {
			const kid = node.child(i);
			if (!kid?.isNamed) continue;
			const name = node.fieldNameForChild(i);
			if (name !== null && skip.has(name)) continue;
			walk(kid, ctx, false);
		}
	}

	function enter(ctx: Ctx, qualifiedName: string, decl: Node): Ctx {
		return {
			...ctx,
			parent: qualifiedName,
			scope: qualifiedName,
			classExported: null,
			typeParams: union(
				ctx.typeParams,
				typeParamNames(field(decl, "type_parameters")),
			),
		};
	}

	function walk(node: Node, ctx: Ctx, exported: boolean): void {
		switch (node.type) {
			case "comment":
				return;
			case "import_statement":
				importStatement(sink, node);
				return;
			case "export_statement":
				if (!reexportStatement(sink, node)) {
					const decl = field(node, "declaration");
					if (decl) walk(decl, ctx, true);
					walkField(node, "value", ctx);
				}
				return;
			case "function_declaration":
			case "generator_function_declaration":
				functionDecl(node, ctx, exported);
				return;
			case "class_declaration":
			case "abstract_class_declaration":
				classDecl(node, ctx, exported);
				return;
			case "interface_declaration":
				interfaceDecl(node, ctx, exported);
				return;
			case "type_alias_declaration":
			case "enum_declaration":
				namedDecl(
					node,
					ctx,
					exported,
					node.type === "enum_declaration" ? "enum" : "type",
				);
				return;
			case "internal_module":
			case "module":
				moduleDecl(node, ctx, exported);
				return;
			case "lexical_declaration":
			case "variable_declaration":
				for (const decl of namedKids(node)) {
					if (decl.type === "variable_declarator")
						variableDecl(decl, ctx, exported);
					else walk(decl, ctx, false);
				}
				return;
			case "method_definition":
			case "abstract_method_signature":
			case "method_signature":
				methodDecl(node, ctx);
				return;
			case "public_field_definition":
			case "field_definition":
				fieldDecl(node, ctx);
				return;
			case "call_expression":
				callExpr(node, ctx);
				return;
			case "new_expression":
				newExpr(node, ctx);
				return;
			case "jsx_opening_element":
			case "jsx_self_closing_element":
				jsxElement(node, ctx);
				return;
			case "type_identifier":
				if (!ctx.typeParams.has(node.text))
					addRef(sink, node, node.text, "type", ctx.scope);
				return;
			case "nested_type_identifier": {
				const name = namePath(node);
				if (name) addRef(sink, node, name, "type", ctx.scope);
				return;
			}
			case "type_parameter":
				// The name is a declaration; constraints and defaults are refs.
				walkField(node, "constraint", ctx);
				walkField(node, "value", ctx);
				return;
			default:
				children(node, ctx);
		}
	}

	function functionDecl(node: Node, ctx: Ctx, exported: boolean): void {
		const name = field(node, "name");
		if (!name) {
			children(node, ctx);
			return;
		}
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "function",
			parent: ctx.parent,
			exported: isExported(name.text, ctx, exported),
		});
		childrenExcept(node, enter(ctx, qn, node), SKIP_NAME);
	}

	function classDecl(node: Node, ctx: Ctx, exported: boolean): void {
		const name = field(node, "name");
		if (!name) {
			children(node, ctx);
			return;
		}
		const isExp = isExported(name.text, ctx, exported);
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "class",
			parent: ctx.parent,
			exported: isExp,
		});
		const inner = enter(ctx, qn, node);
		for (const kid of namedKids(node)) {
			if (kid.type === "class_heritage") heritage(kid, inner);
		}
		const body = field(node, "body");
		if (body) children(body, { ...inner, classExported: isExp });
	}

	function heritage(node: Node, ctx: Ctx): void {
		for (const clause of namedKids(node)) {
			if (clause.type === "extends_clause") {
				for (const kid of namedKids(clause)) {
					if (kid.type === "type_arguments") {
						children(kid, ctx);
						continue;
					}
					const base = namePath(kid);
					if (base) addRef(sink, kid, base, "inherit", ctx.scope);
					else walk(kid, ctx, false);
				}
			} else if (
				clause.type === "implements_clause" ||
				clause.type === "extends_type_clause"
			) {
				for (const type of namedKids(clause)) inheritType(type, ctx);
			} else {
				// Plain JS: `class A extends B` has the expression directly.
				const base = namePath(clause);
				if (base) addRef(sink, clause, base, "inherit", ctx.scope);
				else walk(clause, ctx, false);
			}
		}
	}

	/** `Base<T>` in a heritage clause: `Base` is inherited, `T` is a type ref. */
	function inheritType(node: Node, ctx: Ctx): void {
		if (node.type === "generic_type") {
			const name = field(node, "name");
			const base = name ? namePath(name) : null;
			if (name && base) addRef(sink, name, base, "inherit", ctx.scope);
			walkField(node, "type_arguments", ctx);
			return;
		}
		const base = namePath(node);
		if (base) addRef(sink, node, base, "inherit", ctx.scope);
		else walk(node, ctx, false);
	}

	function interfaceDecl(node: Node, ctx: Ctx, exported: boolean): void {
		const name = field(node, "name");
		if (!name) {
			children(node, ctx);
			return;
		}
		const isExp = isExported(name.text, ctx, exported);
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "interface",
			parent: ctx.parent,
			exported: isExp,
		});
		const inner = enter(ctx, qn, node);
		for (const kid of namedKids(node)) {
			if (kid.type === "extends_type_clause") {
				for (const type of namedKids(kid)) inheritType(type, inner);
			}
		}
		const body = field(node, "body");
		if (body) children(body, { ...inner, classExported: isExp });
	}

	function namedDecl(
		node: Node,
		ctx: Ctx,
		exported: boolean,
		kind: "type" | "enum",
	): void {
		const name = field(node, "name");
		if (!name) {
			children(node, ctx);
			return;
		}
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind,
			parent: ctx.parent,
			exported: isExported(name.text, ctx, exported),
		});
		childrenExcept(node, enter(ctx, qn, node), SKIP_NAME);
	}

	function moduleDecl(node: Node, ctx: Ctx, exported: boolean): void {
		const name = field(node, "name");
		if (!name || name.type === "string") {
			walkField(node, "body", ctx);
			return;
		}
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "module",
			parent: ctx.parent,
			exported: isExported(name.text, ctx, exported),
		});
		walkField(node, "body", enter(ctx, qn, node));
	}

	function variableDecl(node: Node, ctx: Ctx, exported: boolean): void {
		const name = field(node, "name");
		const value = field(node, "value");
		if (
			name?.type === "identifier" &&
			value &&
			FUNCTION_VALUES.has(value.type)
		) {
			const qn = addSymbol(sink, node, {
				name: name.text,
				kind: "function",
				parent: ctx.parent,
				exported: isExported(name.text, ctx, exported),
			});
			walkField(node, "type", ctx);
			childrenExcept(value, enter(ctx, qn, value), SKIP_NAME);
			return;
		}
		childrenExcept(node, ctx, SKIP_NAME);
	}

	function memberName(node: Node): Node | null {
		return field(node, "name") ?? field(node, "property");
	}

	function isPrivateMember(node: Node, name: Node): boolean {
		if (name.type === "private_property_identifier") return true;
		return namedKids(node).some(
			(k) =>
				k.type === "accessibility_modifier" &&
				(k.text === "private" || k.text === "protected"),
		);
	}

	function methodDecl(node: Node, ctx: Ctx): void {
		const name = memberName(node);
		if (!name || ctx.classExported === null) {
			children(node, ctx);
			return;
		}
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "method",
			parent: ctx.parent,
			exported: ctx.classExported && !isPrivateMember(node, name),
		});
		childrenExcept(node, enter(ctx, qn, node), SKIP_MEMBER_NAME);
	}

	function fieldDecl(node: Node, ctx: Ctx): void {
		const name = memberName(node);
		const value = field(node, "value");
		if (
			name &&
			value &&
			ctx.classExported !== null &&
			FUNCTION_VALUES.has(value.type)
		) {
			const qn = addSymbol(sink, node, {
				name: name.text,
				kind: "method",
				parent: ctx.parent,
				exported: ctx.classExported && !isPrivateMember(node, name),
			});
			walkField(node, "type", ctx);
			childrenExcept(value, enter(ctx, qn, value), SKIP_NAME);
			return;
		}
		childrenExcept(node, ctx, SKIP_MEMBER_NAME);
	}

	function callExpr(node: Node, ctx: Ctx): void {
		const callee = field(node, "function");
		const args = field(node, "arguments");
		if (!callee) {
			children(node, ctx);
			return;
		}
		const argList = args ? namedKids(args) : [];

		if (callee.type === "import") {
			const source = stringValue(argList[0]);
			if (source !== null) addImport(sink, node, { source, names: [] });
			children(node, ctx);
			return;
		}
		if (callee.type === "super") {
			walkField(node, "arguments", ctx);
			return;
		}

		recordCall(node, callee, ctx);
		if (
			callee.type === "identifier" &&
			callee.text === "require" &&
			argList.length === 1
		) {
			const source = stringValue(argList[0]);
			if (source !== null) addImport(sink, node, { source, names: [] });
		}

		const kind = testKind(callee);
		const title = stringValue(argList[0]);
		const hasBody = argList.some((a) => FUNCTION_VALUES.has(a.type));
		if (kind !== null && title !== null && hasBody) {
			const qn = ctx.suite === null ? title : `${ctx.suite} > ${title}`;
			addTest(sink, node, {
				name: title,
				kind,
				scope: ctx.suite ?? ctx.scope,
				qualifiedName: qn,
			});
			walk(callee, ctx, false);
			if (args) children(args, { ...ctx, scope: qn, suite: qn });
			return;
		}
		children(node, ctx);
	}

	function recordCall(node: Node, callee: Node, ctx: Ctx): void {
		if (callee.type === "identifier") {
			addCall(sink, node, {
				name: callee.text,
				receiver: null,
				member: false,
				kind: "call",
				scope: ctx.scope,
			});
		} else if (callee.type === "member_expression") {
			const property = field(callee, "property");
			const object = field(callee, "object");
			if (!property || !object) return;
			addCall(sink, node, {
				name: property.text,
				receiver: namePath(object),
				member: true,
				kind: "call",
				scope: ctx.scope,
			});
		}
	}

	function newExpr(node: Node, ctx: Ctx): void {
		const ctor = field(node, "constructor");
		const path = ctor ? namePath(ctor) : null;
		if (path !== null) {
			const dot = path.lastIndexOf(".");
			addCall(sink, node, {
				name: path.slice(dot + 1),
				receiver: dot < 0 ? null : path.slice(0, dot),
				member: dot >= 0,
				kind: "new",
				scope: ctx.scope,
			});
		}
		children(node, ctx);
	}

	function jsxElement(node: Node, ctx: Ctx): void {
		const name = field(node, "name");
		const path = name ? namePath(name) : null;
		// Lower-case tags are intrinsic elements (`<div>`), not components.
		if (path !== null && (path.includes(".") || /^[A-Z_$]/.test(path))) {
			const dot = path.lastIndexOf(".");
			addCall(sink, node, {
				name: path.slice(dot + 1),
				receiver: dot < 0 ? null : path.slice(0, dot),
				member: dot >= 0,
				kind: "jsx",
				scope: ctx.scope,
			});
		}
		childrenExcept(node, ctx, SKIP_NAME);
	}

	return { children };
}

const SKIP_NAME: ReadonlySet<string> = new Set(["name"]);
const SKIP_MEMBER_NAME: ReadonlySet<string> = new Set(["name", "property"]);
