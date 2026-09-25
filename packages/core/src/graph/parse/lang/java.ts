/**
 * Java extractor. public/protected members of an exported type are exported;
 * interface members are implicitly public. JUnit 4/5 annotations mark tests.
 */

import {
	addCall,
	addImport,
	addRef,
	addSymbol,
	addTest,
	field,
	insertSuite,
	type Node,
	namedKids,
	type Sink,
	typeParamNames,
	union,
} from "../nodes";
import type { SymbolKind } from "../types";

type Ctx = Readonly<{
	parent: string | null;
	scope: string | null;
	/** Inside a type body: whether that type is exported, and whether it is an interface. */
	owner: Readonly<{ exported: boolean; iface: boolean }> | null;
	typeParams: ReadonlySet<string>;
}>;

const TOP: Ctx = {
	parent: null,
	scope: null,
	owner: null,
	typeParams: new Set(),
};

const TYPE_KINDS: Readonly<Record<string, SymbolKind>> = {
	class_declaration: "class",
	record_declaration: "class",
	interface_declaration: "interface",
	annotation_type_declaration: "interface",
	enum_declaration: "enum",
};

const TEST_ANNOTATIONS = new Set([
	"Test",
	"ParameterizedTest",
	"RepeatedTest",
	"TestFactory",
	"TestTemplate",
]);

function modifiers(node: Node): Node | null {
	return namedKids(node).find((k) => k.type === "modifiers") ?? null;
}

function hasModifier(node: Node, ...words: readonly string[]): boolean {
	const mods = modifiers(node);
	if (!mods) return false;
	return mods.children.some((c) => c !== null && words.includes(c.type));
}

function annotations(node: Node): readonly string[] {
	const mods = modifiers(node);
	if (!mods) return [];
	return namedKids(mods).flatMap((a) => {
		if (a.type !== "marker_annotation" && a.type !== "annotation") return [];
		const name = field(a, "name");
		if (!name) return [];
		const text = name.text;
		return [text.slice(text.lastIndexOf(".") + 1)];
	});
}

/** A member is exported when it is public (explicitly, or as an interface member) inside an exported type. */
function memberExported(node: Node, ctx: Ctx): boolean {
	const owner = ctx.owner;
	const visible =
		hasModifier(node, "public", "protected") ||
		(owner?.iface === true && !hasModifier(node, "private"));
	return visible && (owner === null || owner.exported);
}

export function extractJava(root: Node, sink: Sink): void {
	const walk = (node: Node, ctx: Ctx): void => {
		switch (node.type) {
			case "line_comment":
			case "block_comment":
			case "package_declaration":
			case "modifiers":
				return;
			case "import_declaration":
				importDecl(sink, node);
				return;
			case "class_declaration":
			case "record_declaration":
			case "interface_declaration":
			case "annotation_type_declaration":
			case "enum_declaration":
				typeDecl(node, ctx);
				return;
			case "method_declaration":
			case "constructor_declaration":
			case "compact_constructor_declaration":
				methodDecl(node, ctx);
				return;
			case "method_invocation":
				invocation(node, ctx);
				return;
			case "object_creation_expression":
				creation(node, ctx);
				return;
			case "explicit_constructor_invocation":
				// super(…) / this(…): only the arguments matter.
				walkParts(node, ctx, ["arguments"]);
				return;
			case "type_identifier":
				if (!ctx.typeParams.has(node.text))
					addRef(sink, node, node.text, "type", ctx.scope);
				return;
			case "scoped_type_identifier":
				addRef(sink, node, node.text, "type", ctx.scope);
				return;
			default:
				for (const kid of namedKids(node)) walk(kid, ctx);
		}
	};

	const walkParts = (node: Node, ctx: Ctx, parts: readonly string[]): void => {
		for (const part of parts) {
			const kid = field(node, part);
			if (kid) walk(kid, ctx);
		}
	};

	const enter = (ctx: Ctx, qn: string, decl: Node): Ctx => ({
		parent: qn,
		scope: qn,
		owner: null,
		typeParams: union(
			ctx.typeParams,
			typeParamNames(field(decl, "type_parameters")),
		),
	});

	const inherit = (node: Node, ctx: Ctx): void => {
		if (node.type === "type_list") {
			for (const kid of namedKids(node)) inherit(kid, ctx);
			return;
		}
		if (node.type === "generic_type") {
			const base = namedKids(node).find(
				(k) =>
					k.type === "type_identifier" || k.type === "scoped_type_identifier",
			);
			if (base) addRef(sink, base, base.text, "inherit", ctx.scope);
			for (const kid of namedKids(node)) {
				if (kid.type === "type_arguments") walk(kid, ctx);
			}
			return;
		}
		if (
			node.type === "type_identifier" ||
			node.type === "scoped_type_identifier"
		) {
			addRef(sink, node, node.text, "inherit", ctx.scope);
			return;
		}
		for (const kid of namedKids(node)) inherit(kid, ctx);
	};

	const typeDecl = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		const kind = TYPE_KINDS[node.type];
		if (!name || !kind) return;
		const exported = memberExported(node, ctx);
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind,
			parent: ctx.parent,
			exported,
		});
		const inner = enter(ctx, qn, node);
		for (const kid of namedKids(node)) {
			if (
				kid.type === "superclass" ||
				kid.type === "super_interfaces" ||
				kid.type === "extends_interfaces"
			)
				inherit(kid, inner);
		}
		// Record components: `record Point(Coord x, int y)`.
		walkParts(node, inner, ["parameters"]);
		const body = field(node, "body");
		if (!body) return;
		const from = sink.tests.length;
		walk(body, {
			...inner,
			owner: { exported, iface: kind === "interface" },
		});
		const hasCase = sink.tests
			.slice(from)
			.some((t) => t.kind === "case" && t.scope === qn);
		if (hasCase) {
			insertSuite(sink, from, node, {
				name: name.text,
				scope: ctx.parent,
				qualifiedName: qn,
			});
		}
	};

	const methodDecl = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		if (!name) return;
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "method",
			parent: ctx.parent,
			exported: memberExported(node, ctx),
		});
		if (annotations(node).some((a) => TEST_ANNOTATIONS.has(a))) {
			addTest(sink, node, {
				name: name.text,
				kind: "case",
				scope: ctx.parent,
				qualifiedName: qn,
			});
		}
		walkParts(node, enter(ctx, qn, node), [
			"type_parameters",
			"type",
			"parameters",
			"body",
		]);
		for (const kid of namedKids(node)) {
			if (kid.type === "throws") walk(kid, enter(ctx, qn, node));
		}
	};

	const invocation = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		const object = field(node, "object");
		if (name) {
			addCall(sink, node, {
				name: name.text,
				receiver: object ? namePath(object) : null,
				member: object !== null,
				kind: "call",
				scope: ctx.scope,
			});
		}
		walkParts(node, ctx, ["object", "type_arguments", "arguments"]);
	};

	const creation = (node: Node, ctx: Ctx): void => {
		const type = field(node, "type");
		const base =
			type?.type === "generic_type"
				? namedKids(type).find(
						(k) =>
							k.type === "type_identifier" ||
							k.type === "scoped_type_identifier",
					)
				: type;
		if (
			base &&
			(base.type === "type_identifier" ||
				base.type === "scoped_type_identifier")
		) {
			const text = base.text;
			const dot = text.lastIndexOf(".");
			addCall(sink, node, {
				name: text.slice(dot + 1),
				receiver: dot < 0 ? null : text.slice(0, dot),
				member: dot >= 0,
				kind: "new",
				scope: ctx.scope,
			});
		}
		if (type?.type === "generic_type") {
			for (const kid of namedKids(type)) {
				if (kid.type === "type_arguments") walk(kid, ctx);
			}
		}
		// The created type is the call above, not also a type reference. An
		// anonymous class body's members are never visible outside it.
		const anonymous: Ctx = { ...ctx, owner: { exported: false, iface: false } };
		for (const kid of namedKids(node)) {
			if (kid.id === type?.id) continue;
			walk(kid, kid.type === "class_body" ? anonymous : ctx);
		}
	};

	for (const kid of namedKids(root)) walk(kid, TOP);
}

function namePath(node: Node): string | null {
	switch (node.type) {
		case "identifier":
		case "this":
		case "super":
			return node.text;
		case "field_access": {
			const object = field(node, "object");
			const name = field(node, "field");
			const head = object ? namePath(object) : null;
			return head !== null && name ? `${head}.${name.text}` : null;
		}
		case "scoped_identifier":
			return node.text;
		default:
			return null;
	}
}

function importDecl(sink: Sink, node: Node): void {
	const path = namedKids(node).find(
		(k) => k.type === "scoped_identifier" || k.type === "identifier",
	);
	if (!path) return;
	const wildcard = namedKids(node).some((k) => k.type === "asterisk");
	if (wildcard || path.type === "identifier") {
		addImport(sink, node, {
			source: path.text,
			names: [{ name: "*", alias: null }],
		});
		return;
	}
	const scope = field(path, "scope");
	const name = field(path, "name");
	if (!scope || !name) return;
	addImport(sink, node, {
		source: scope.text,
		names: [{ name: name.text, alias: null }],
	});
}
