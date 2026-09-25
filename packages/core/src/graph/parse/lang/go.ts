/** Go extractor. Exported means the name starts with an upper-case letter. */

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
	unquote,
} from "../nodes";

type Ctx = Readonly<{
	parent: string | null;
	scope: string | null;
	typeParams: ReadonlySet<string>;
}>;

const TOP: Ctx = { parent: null, scope: null, typeParams: new Set() };

/** Predeclared types: the grammar does not tell them apart from user types. */
const PREDECLARED = new Set([
	"any",
	"bool",
	"byte",
	"comparable",
	"complex64",
	"complex128",
	"error",
	"float32",
	"float64",
	"int",
	"int8",
	"int16",
	"int32",
	"int64",
	"rune",
	"string",
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"uintptr",
]);

const TEST_FUNC = /^(?:Test|Benchmark|Fuzz|Example)(?:$|[^\p{Ll}])/u;

const isExported = (name: string): boolean => /^\p{Lu}/u.test(name);

export function extractGo(root: Node, sink: Sink): void {
	const walk = (node: Node, ctx: Ctx): void => {
		switch (node.type) {
			case "comment":
			case "package_clause":
				return;
			case "import_spec":
				importSpec(sink, node);
				return;
			case "function_declaration":
				funcDecl(node, ctx);
				return;
			case "method_declaration":
				methodDecl(node, ctx);
				return;
			case "type_spec":
			case "type_alias":
				typeSpec(node, ctx);
				return;
			case "call_expression":
				call(node, ctx);
				return;
			case "type_identifier":
				if (!PREDECLARED.has(node.text) && !ctx.typeParams.has(node.text))
					addRef(sink, node, node.text, "type", ctx.scope);
				return;
			case "qualified_type":
				addRef(sink, node, node.text, "type", ctx.scope);
				return;
			case "field_declaration":
				fieldDecl(node, ctx);
				return;
			case "type_elem":
				typeElem(node, ctx);
				return;
			case "type_conversion_expression":
				conversion(node, ctx);
				return;
			case "method_elem":
				methodElem(node, ctx);
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
		typeParams: union(
			ctx.typeParams,
			typeParamNames(field(decl, "type_parameters")),
		),
	});

	const funcDecl = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		if (!name) return;
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "function",
			parent: ctx.parent,
			exported: isExported(name.text),
		});
		if (TEST_FUNC.test(name.text)) {
			addTest(sink, node, {
				name: name.text,
				kind: "case",
				scope: ctx.parent,
				qualifiedName: qn,
			});
		}
		walkParts(node, enter(ctx, qn, node), [
			"type_parameters",
			"parameters",
			"result",
			"body",
		]);
	};

	const methodDecl = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		const receiver = field(node, "receiver");
		const owner = receiver ? receiverType(receiver) : null;
		if (!name) return;
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "method",
			parent: owner?.name ?? null,
			exported: isExported(name.text),
		});
		const inner = enter(ctx, qn, node);
		walkParts(
			node,
			{
				...inner,
				typeParams: union(inner.typeParams, owner?.params ?? new Set()),
			},
			["parameters", "result", "body"],
		);
	};

	const typeSpec = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		const type = field(node, "type");
		if (!name) return;
		const kind =
			node.type === "type_alias"
				? "type"
				: type?.type === "struct_type"
					? "struct"
					: type?.type === "interface_type"
						? "interface"
						: "type";
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind,
			parent: ctx.parent,
			exported: isExported(name.text),
		});
		walkParts(node, enter(ctx, qn, node), ["type_parameters", "type"]);
	};

	const methodElem = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		if (!name) return;
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "method",
			parent: ctx.parent,
			exported: isExported(name.text),
		});
		walkParts(node, { ...ctx, scope: qn }, ["parameters", "result"]);
	};

	/** A struct field with no name embeds its type. */
	const fieldDecl = (node: Node, ctx: Ctx): void => {
		const type = field(node, "type");
		if (!type) return;
		if (field(node, "name")) walk(type, ctx);
		else embedded(type, ctx);
	};

	const embedded = (node: Node, ctx: Ctx): void => {
		const base = node.type === "pointer_type" ? namedKids(node)[0] : node;
		if (base?.type === "type_identifier" || base?.type === "qualified_type")
			addRef(sink, base, base.text, "inherit", ctx.scope);
		else if (base) walk(base, ctx);
	};

	/**
	 * A `type_elem` is an embedded interface only when it is a single type
	 * directly inside an interface; a union (`~int | Num`) is a constraint, and
	 * everywhere else it is a generic type argument (`List[Item]`).
	 */
	const typeElem = (node: Node, ctx: Ctx): void => {
		const kids = namedKids(node);
		const only = kids.length === 1 ? kids[0] : undefined;
		if (node.parent?.type === "interface_type" && only) embedded(only, ctx);
		else for (const kid of kids) walk(kid, ctx);
	};

	/**
	 * `New[Item](x)` parses as a conversion to a generic type; with one
	 * argument the grammar cannot tell it from an instantiated generic
	 * function call, and a plain `T(x)` conversion is already a call.
	 */
	const conversion = (node: Node, ctx: Ctx): void => {
		const type = field(node, "type");
		const base = type?.type === "generic_type" ? field(type, "type") : null;
		if (type && base) {
			const pkg =
				base.type === "qualified_type" ? field(base, "package") : null;
			const name = base.type === "qualified_type" ? field(base, "name") : base;
			if (name?.type === "type_identifier") {
				addCall(sink, node, {
					name: name.text,
					receiver: pkg?.text ?? null,
					member: pkg !== null,
					kind: "call",
					scope: ctx.scope,
				});
			}
			walkParts(type, ctx, ["type_arguments"]);
			walkParts(node, ctx, ["operand"]);
			return;
		}
		for (const kid of namedKids(node)) walk(kid, ctx);
	};

	const call = (node: Node, ctx: Ctx): void => {
		const callee = field(node, "function");
		// `F[int](a, b)`: the grammar reads the instantiation as an index.
		const fn =
			callee?.type === "index_expression" ? field(callee, "operand") : callee;
		if (fn?.type === "identifier") {
			addCall(sink, node, {
				name: fn.text,
				receiver: null,
				member: false,
				kind: "call",
				scope: ctx.scope,
			});
		} else if (fn?.type === "selector_expression") {
			const fieldName = field(fn, "field");
			const operand = field(fn, "operand");
			if (fieldName && operand) {
				addCall(sink, node, {
					name: fieldName.text,
					receiver: namePath(operand),
					member: true,
					kind: "call",
					scope: ctx.scope,
				});
			}
		}
		for (const kid of namedKids(node)) walk(kid, ctx);
	};

	for (const kid of namedKids(root)) walk(kid, TOP);
}

function namePath(node: Node): string | null {
	if (node.type === "identifier") return node.text;
	if (node.type === "selector_expression") {
		const operand = field(node, "operand");
		const name = field(node, "field");
		const head = operand ? namePath(operand) : null;
		return head !== null && name ? `${head}.${name.text}` : null;
	}
	return null;
}

type Receiver = Readonly<{ name: string; params: ReadonlySet<string> }>;

/**
 * `(c *Circle)`, `(c Circle)`, `(l *List[T])` → the receiver's type name and
 * the type parameters it binds (`T`).
 */
function receiverType(list: Node): Receiver | null {
	const param = namedKids(list).find((k) => k.type === "parameter_declaration");
	let type = param ? field(param, "type") : null;
	let params: ReadonlySet<string> = new Set();
	while (type) {
		if (type.type === "type_identifier") return { name: type.text, params };
		if (type.type === "pointer_type" || type.type === "parenthesized_type")
			type = namedKids(type)[0] ?? null;
		else if (type.type === "generic_type") {
			const args = field(type, "type_arguments");
			if (args) {
				params = new Set(
					args
						.descendantsOfType("type_identifier")
						.flatMap((n) => (n === null ? [] : [n.text])),
				);
			}
			type = field(type, "type");
		} else return null;
	}
	return null;
}

function importSpec(sink: Sink, node: Node): void {
	const path = field(node, "path");
	if (!path) return;
	const name = field(node, "name");
	const source = unquote(path);
	if (name?.type === "blank_identifier") {
		addImport(sink, node, { source, names: [] });
		return;
	}
	addImport(sink, node, {
		source,
		names: [{ name: "*", alias: name ? name.text : null }],
	});
}
