/**
 * Shared helpers for the per-language extractors: syntax-node access, spans
 * and the sink that collects one file's facts.
 *
 * The sink is a set of plain arrays owned by a single `extract()` call; it
 * never outlives that call, and the arrays are handed out as readonly.
 */

import type { Node } from "@vscode/tree-sitter-wasm";
import type {
	CallKind,
	ImportBinding,
	ParsedCall,
	ParsedImport,
	ParsedRef,
	ParsedSymbol,
	ParsedTest,
	Span,
	SymbolKind,
	SyntaxIssue,
} from "./types";

export type { Node };

export type Sink = {
	readonly symbols: ParsedSymbol[];
	readonly imports: ParsedImport[];
	readonly calls: ParsedCall[];
	readonly refs: ParsedRef[];
	readonly tests: ParsedTest[];
};

export function newSink(): Sink {
	return { symbols: [], imports: [], calls: [], refs: [], tests: [] };
}

export function spanOf(node: Node): Span {
	return {
		startLine: node.startPosition.row + 1,
		startColumn: node.startPosition.column,
		endLine: node.endPosition.row + 1,
		endColumn: node.endPosition.column,
	};
}

/** Named children, without the nulls the binding may hand back. */
export function namedKids(node: Node): readonly Node[] {
	return node.namedChildren.filter((c): c is Node => c !== null);
}

/** All children, anonymous tokens included. */
export function allKids(node: Node): readonly Node[] {
	return node.children.filter((c): c is Node => c !== null);
}

export function field(node: Node, name: string): Node | null {
	return node.childForFieldName(name);
}

/** True when `node` has an anonymous child token with exactly this text (`"type"`, `"static"`). */
export function hasToken(node: Node, token: string): boolean {
	return allKids(node).some((c) => !c.isNamed && c.type === token);
}

export function qualify(parent: string | null, name: string): string {
	return parent === null ? name : `${parent}.${name}`;
}

/** Text inside a quoted string literal node (`"x"`, `'x'`, `` `x` ``). */
export function unquote(node: Node): string {
	const text = node.text;
	return text.length >= 2 ? text.slice(1, -1) : text;
}

/**
 * Names declared by a type-parameter list (`<T, U extends X>`, `[T any]`),
 * so the extractors do not report them as type references.
 */
export function typeParamNames(list: Node | null): ReadonlySet<string> {
	if (list === null) return new Set();
	const names = namedKids(list).flatMap((param) => {
		if (param.type === "type_identifier") return [param.text];
		const declared = param
			.childrenForFieldName("name")
			.filter((c): c is Node => c !== null);
		if (declared.length > 0) return declared.map((c) => c.text);
		const named =
			field(param, "left") ??
			namedKids(param).find(
				(c) => c.type === "type_identifier" || c.type === "identifier",
			);
		return named === undefined || named === null ? [] : [named.text];
	});
	return new Set(names);
}

export function union(
	a: ReadonlySet<string>,
	b: ReadonlySet<string>,
): ReadonlySet<string> {
	if (b.size === 0) return a;
	if (a.size === 0) return b;
	return new Set([...a, ...b]);
}

export function addSymbol(
	sink: Sink,
	node: Node,
	symbol: Readonly<{
		name: string;
		kind: SymbolKind;
		parent: string | null;
		exported: boolean;
	}>,
): string {
	const qualifiedName = qualify(symbol.parent, symbol.name);
	sink.symbols.push({ ...symbol, qualifiedName, span: spanOf(node) });
	return qualifiedName;
}

export function addImport(
	sink: Sink,
	node: Node,
	entry: Readonly<{
		source: string;
		names: readonly ImportBinding[];
		kind?: ParsedImport["kind"];
		typeOnly?: boolean;
	}>,
): void {
	sink.imports.push({
		source: entry.source,
		names: entry.names,
		kind: entry.kind ?? "import",
		typeOnly: entry.typeOnly ?? false,
		span: spanOf(node),
	});
}

export function addCall(
	sink: Sink,
	node: Node,
	call: Readonly<{
		name: string;
		receiver: string | null;
		member: boolean;
		kind: CallKind;
		scope: string | null;
		/** Separator between receiver and name in `callee`; `.` unless the language writes `::`. */
		separator?: string;
	}>,
): void {
	const { separator = ".", ...rest } = call;
	const callee =
		call.receiver === null
			? call.name
			: `${call.receiver}${separator}${call.name}`;
	sink.calls.push({ ...rest, callee, span: spanOf(node) });
}

export function addRef(
	sink: Sink,
	node: Node,
	name: string,
	kind: ParsedRef["kind"],
	scope: string | null,
): void {
	sink.refs.push({ name, kind, scope, span: spanOf(node) });
}

export function addTest(
	sink: Sink,
	node: Node,
	test: Readonly<{
		name: string;
		kind: ParsedTest["kind"];
		scope: string | null;
		qualifiedName: string;
	}>,
): void {
	sink.tests.push({ ...test, span: spanOf(node) });
}

/**
 * Inserts a suite in front of the cases recorded since `from` when any of
 * them belongs to `qualifiedName` (JUnit classes, Rust test modules are
 * recognised by their cases or attributes after their body is walked).
 */
export function insertSuite(
	sink: Sink,
	from: number,
	node: Node,
	suite: Readonly<{
		name: string;
		scope: string | null;
		qualifiedName: string;
	}>,
): void {
	sink.tests.splice(from, 0, { ...suite, kind: "suite", span: spanOf(node) });
}

const MAX_ERROR_TEXT = 80;

/** Every ERROR and MISSING node, outermost first; nothing below an ERROR node is reported twice. */
export function collectErrors(root: Node): readonly SyntaxIssue[] {
	const issues: SyntaxIssue[] = [];
	const stack: Node[] = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		if (node === undefined) break;
		if (node.isMissing) {
			issues.push({ kind: "missing", text: node.type, span: spanOf(node) });
			continue;
		}
		if (node.isError) {
			const firstLine = node.text.split("\n", 1)[0] ?? "";
			issues.push({
				kind: "error",
				text: firstLine.trim().slice(0, MAX_ERROR_TEXT),
				span: spanOf(node),
			});
			continue;
		}
		if (!node.hasError) continue;
		const kids = allKids(node);
		for (let i = kids.length - 1; i >= 0; i--) {
			const kid = kids[i];
			if (kid !== undefined) stack.push(kid);
		}
	}
	return issues;
}
