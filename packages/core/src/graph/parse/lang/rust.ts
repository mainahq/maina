/**
 * Rust extractor. `pub` (any form) means exported. Macro arguments are token
 * trees the grammar does not parse, so calls inside them (`assert!(f(x))`)
 * are recovered from the token sequence.
 */

import {
	addCall,
	addImport,
	addRef,
	addSymbol,
	addTest,
	allKids,
	field,
	insertSuite,
	type Node,
	namedKids,
	qualify,
	type Sink,
	typeParamNames,
	union,
} from "../nodes";
import type { ImportBinding, SymbolKind } from "../types";

type Ctx = Readonly<{
	/** Qualified name of the enclosing module (`tests`, `a.b`), or null at crate level. */
	module: string | null;
	parent: string | null;
	scope: string | null;
	/** Inside an impl or trait body: how its functions are exported. */
	owner: Readonly<{ exported: "pub" | "always" }> | null;
	typeParams: ReadonlySet<string>;
}>;

const TOP: Ctx = {
	module: null,
	parent: null,
	scope: null,
	owner: null,
	typeParams: new Set(),
};

const ITEM_KINDS: Readonly<Record<string, SymbolKind>> = {
	struct_item: "struct",
	union_item: "struct",
	enum_item: "enum",
	trait_item: "trait",
	type_item: "type",
};

const isPub = (node: Node): boolean =>
	namedKids(node).some((k) => k.type === "visibility_modifier");

const isComment = (node: Node): boolean =>
	node.type === "line_comment" || node.type === "block_comment";

/** Outer attributes (`#[test]`) written before an item; comments between them are skipped. */
function attributesOf(node: Node): readonly string[] {
	const out: string[] = [];
	let prev = node.previousNamedSibling;
	while (prev && (prev.type === "attribute_item" || isComment(prev))) {
		const attr = namedKids(prev).find((k) => k.type === "attribute");
		if (attr) out.push(attr.text.replace(/\s+/g, ""));
		prev = prev.previousNamedSibling;
	}
	return out;
}

const isTestAttr = (attr: string): boolean =>
	attr === "test" || attr.endsWith("::test") || attr === "rstest";

/** The written type name, without generic arguments or references. */
function baseTypeName(node: Node | null): Node | null {
	if (!node) return null;
	switch (node.type) {
		case "type_identifier":
		case "scoped_type_identifier":
			return node;
		case "generic_type":
			return baseTypeName(field(node, "type"));
		case "reference_type":
		case "pointer_type":
			return baseTypeName(field(node, "type"));
		default:
			return null;
	}
}

export function extractRust(root: Node, sink: Sink): void {
	const walk = (node: Node, ctx: Ctx): void => {
		switch (node.type) {
			case "line_comment":
			case "block_comment":
			case "attribute_item":
			case "inner_attribute_item":
			case "macro_definition":
				return;
			case "use_declaration":
				useDecl(sink, node);
				return;
			case "extern_crate_declaration": {
				const name = field(node, "name");
				const alias = field(node, "alias");
				if (name) {
					addImport(sink, node, {
						source: name.text,
						names: [{ name: "*", alias: alias?.text ?? null }],
					});
				}
				return;
			}
			case "function_item":
			case "function_signature_item":
				fnItem(node, ctx);
				return;
			case "struct_item":
			case "union_item":
			case "enum_item":
			case "trait_item":
			case "type_item":
				typeItem(node, ctx);
				return;
			case "impl_item":
				implItem(node, ctx);
				return;
			case "mod_item":
				modItem(node, ctx);
				return;
			case "call_expression":
				call(node, ctx);
				return;
			case "macro_invocation":
				macro(node, ctx);
				return;
			case "type_identifier":
				if (node.text !== "Self" && !ctx.typeParams.has(node.text))
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
		...ctx,
		parent: qn,
		scope: qn,
		owner: null,
		typeParams: union(
			ctx.typeParams,
			typeParamNames(field(decl, "type_parameters")),
		),
	});

	const fnItem = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		if (!name) return;
		const exported = ctx.owner?.exported === "always" ? true : isPub(node);
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: ctx.owner ? "method" : "function",
			parent: ctx.parent,
			exported,
		});
		if (node.type === "function_item" && attributesOf(node).some(isTestAttr)) {
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
			"return_type",
			"body",
		]);
	};

	const typeItem = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		const kind = ITEM_KINDS[node.type];
		if (!name || !kind) return;
		const exported = isPub(node);
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind,
			parent: ctx.parent,
			exported,
		});
		const inner = enter(ctx, qn, node);
		const bounds = field(node, "bounds");
		if (bounds) {
			for (const bound of namedKids(bounds)) inherit(bound, inner);
		}
		walkParts(node, inner, ["type"]);
		const body = field(node, "body");
		if (!body) return;
		if (node.type === "trait_item") {
			const traitCtx: Ctx = {
				...inner,
				owner: { exported: exported ? "always" : "pub" },
			};
			for (const kid of namedKids(body)) walk(kid, traitCtx);
		} else walk(body, inner);
	};

	const inherit = (node: Node, ctx: Ctx): void => {
		const base = baseTypeName(node);
		if (base) addRef(sink, base, base.text, "inherit", ctx.scope);
		const args =
			node.type === "generic_type" ? field(node, "type_arguments") : null;
		if (args) walk(args, ctx);
		if (!base && !args) walk(node, ctx);
	};

	const implItem = (node: Node, ctx: Ctx): void => {
		const type = baseTypeName(field(node, "type"));
		const owner = type ? qualify(ctx.module, type.text) : ctx.parent;
		const inner: Ctx = {
			...ctx,
			parent: owner,
			scope: owner,
			owner: null,
			typeParams: union(
				ctx.typeParams,
				typeParamNames(field(node, "type_parameters")),
			),
		};
		const trait = field(node, "trait");
		if (trait) inherit(trait, inner);
		const body = field(node, "body");
		if (!body) return;
		const implCtx: Ctx = {
			...inner,
			// Trait-impl methods are as visible as the trait itself.
			owner: { exported: trait ? "always" : "pub" },
		};
		for (const kid of namedKids(body)) walk(kid, implCtx);
	};

	const modItem = (node: Node, ctx: Ctx): void => {
		const name = field(node, "name");
		if (!name) return;
		const qn = addSymbol(sink, node, {
			name: name.text,
			kind: "module",
			parent: ctx.parent,
			exported: isPub(node),
		});
		const body = field(node, "body");
		if (!body) return;
		const from = sink.tests.length;
		for (const kid of namedKids(body))
			walk(kid, { ...TOP, module: qn, parent: qn, scope: qn });
		if (attributesOf(node).includes("cfg(test)")) {
			insertSuite(sink, from, node, {
				name: name.text,
				scope: ctx.parent,
				qualifiedName: qn,
			});
		}
	};

	const call = (node: Node, ctx: Ctx): void => {
		const target = callTarget(field(node, "function"));
		if (target)
			addCall(sink, node, { ...target, kind: "call", scope: ctx.scope });
		for (const kid of namedKids(node)) walk(kid, ctx);
	};

	const macro = (node: Node, ctx: Ctx): void => {
		const name = field(node, "macro");
		if (name) {
			const scoped = name.type === "scoped_identifier";
			const path = scoped ? field(name, "path") : null;
			const last = scoped ? field(name, "name") : name;
			addCall(sink, node, {
				name: last?.text ?? name.text,
				receiver: path?.text ?? null,
				member: scoped,
				kind: "macro",
				scope: ctx.scope,
				separator: "::",
			});
		}
		for (const kid of namedKids(node)) {
			if (kid.type === "token_tree") tokenCalls(kid, ctx);
		}
	};

	/** `f(…)`, `a::f(…)`, `x.f(…)` and `m!(…)` inside an unparsed macro token tree. */
	const tokenCalls = (tree: Node, ctx: Ctx): void => {
		const toks = allKids(tree);
		for (let i = 0; i < toks.length; i++) {
			const tok = toks[i];
			if (!tok) continue;
			if (tok.type === "token_tree") {
				tokenCalls(tok, ctx);
				continue;
			}
			if (tok.type !== "identifier") continue;
			const next = toks[i + 1];
			const isMacro = next?.type === "!" && toks[i + 2]?.type === "token_tree";
			const isCall = next?.type === "token_tree" && next.child(0)?.type === "(";
			if (!isMacro && !isCall) continue;
			const sep = toks[i - 1]?.type;
			let receiver: string | null = null;
			let separator = ".";
			if (sep === "." || sep === "::") {
				separator = sep;
				let k = i - 1;
				let path = "";
				while (
					k >= 1 &&
					(toks[k]?.type === "." || toks[k]?.type === "::") &&
					isNameToken(toks[k - 1])
				) {
					path = `${toks[k - 1]?.text}${toks[k]?.type}${path}`;
					k -= 2;
				}
				const broken =
					k >= 0 && (toks[k]?.type === "." || toks[k]?.type === "::");
				receiver = path === "" || broken ? null : path.slice(0, -sep.length);
			}
			addCall(sink, tok, {
				name: tok.text,
				receiver,
				member: sep === "." || sep === "::",
				kind: isMacro ? "macro" : "call",
				scope: ctx.scope,
				separator,
			});
		}
	};

	for (const kid of namedKids(root)) walk(kid, TOP);
}

const isNameToken = (tok: Node | undefined): boolean =>
	tok?.type === "identifier" ||
	tok?.type === "self" ||
	tok?.type === "super" ||
	tok?.type === "crate";

type Target = Readonly<{
	name: string;
	receiver: string | null;
	member: boolean;
	separator: string;
}>;

function callTarget(fn: Node | null): Target | null {
	if (!fn) return null;
	switch (fn.type) {
		case "identifier":
			return { name: fn.text, receiver: null, member: false, separator: "." };
		case "scoped_identifier": {
			const name = field(fn, "name");
			const path = field(fn, "path");
			if (!name) return null;
			return {
				name: name.text,
				receiver: path?.text ?? null,
				member: path !== null,
				separator: "::",
			};
		}
		case "field_expression": {
			const name = field(fn, "field");
			const value = field(fn, "value");
			if (!name || !value) return null;
			return {
				name: name.text,
				receiver: namePath(value),
				member: true,
				separator: ".",
			};
		}
		case "generic_function":
			return callTarget(field(fn, "function"));
		default:
			return null;
	}
}

function namePath(node: Node): string | null {
	switch (node.type) {
		case "identifier":
		case "self":
			return node.text;
		case "field_expression": {
			const value = field(node, "value");
			const name = field(node, "field");
			const head = value ? namePath(value) : null;
			return head !== null && name ? `${head}.${name.text}` : null;
		}
		default:
			return null;
	}
}

type UseEntry = Readonly<{ source: string; binding: ImportBinding }>;

const join = (prefix: string, rest: string): string =>
	prefix === "" ? rest : `${prefix}::${rest}`;

/** Flattens a use tree into (module path, binding) pairs. */
function useEntries(node: Node, prefix: string): readonly UseEntry[] {
	switch (node.type) {
		case "scoped_identifier": {
			const path = field(node, "path");
			const name = field(node, "name");
			if (!name) return [];
			return [
				{
					source: join(prefix, path?.text ?? ""),
					binding: { name: name.text, alias: null },
				},
			];
		}
		case "identifier":
		case "self":
		case "super":
		case "crate":
			return prefix === ""
				? [{ source: node.text, binding: { name: "*", alias: null } }]
				: [{ source: prefix, binding: { name: node.text, alias: null } }];
		case "use_as_clause": {
			const path = field(node, "path");
			const alias = field(node, "alias")?.text ?? null;
			if (!path) return [];
			return useEntries(path, prefix).map((e) => ({
				...e,
				binding: { ...e.binding, alias },
			}));
		}
		case "use_wildcard": {
			const path = namedKids(node)[0];
			return [
				{
					source: path ? join(prefix, path.text) : prefix,
					binding: { name: "*", alias: null },
				},
			];
		}
		case "scoped_use_list": {
			const path = field(node, "path");
			const list = field(node, "list");
			const inner = path ? join(prefix, path.text) : prefix;
			return list ? useEntries(list, inner) : [];
		}
		case "use_list":
			return namedKids(node).flatMap((k) => useEntries(k, prefix));
		default:
			return [];
	}
}

function useDecl(sink: Sink, node: Node): void {
	const argument = field(node, "argument");
	if (!argument) return;
	const grouped = new Map<string, ImportBinding[]>();
	for (const { source, binding } of useEntries(argument, "")) {
		const names = grouped.get(source) ?? [];
		names.push(binding);
		grouped.set(source, names);
	}
	const kind = isPub(node) ? "reexport" : "import";
	for (const [source, names] of grouped) {
		addImport(sink, node, { source, names, kind });
	}
}
