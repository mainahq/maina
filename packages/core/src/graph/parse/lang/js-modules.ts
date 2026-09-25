/**
 * Module-level pieces of the TS/JS extractor: import and re-export
 * statements, local export lists, name paths, string literals and test-block
 * names. The walker that uses them is `js.ts`.
 */

import {
	addImport,
	field,
	hasToken,
	type Node,
	namedKids,
	type Sink,
	unquote,
} from "../nodes";
import type { ImportBinding } from "../types";

const SUITE_NAMES = new Set(["describe", "suite", "context"]);
const CASE_NAMES = new Set(["test", "it"]);
const TEST_MODIFIERS = new Set([
	"skip",
	"only",
	"each",
	"todo",
	"failing",
	"fails",
	"concurrent",
	"sequential",
	"serial",
	"if",
	"skipIf",
	"runIf",
]);

/** Names exported by `export { a, b }` (no `from`) and `export default name`. */
export function collectLocalExports(root: Node): ReadonlySet<string> {
	const names = new Set<string>();
	for (const stmt of namedKids(root)) {
		if (stmt.type !== "export_statement" || field(stmt, "source")) continue;
		for (const kid of namedKids(stmt)) {
			if (kid.type !== "export_clause") continue;
			for (const spec of namedKids(kid)) {
				const name = field(spec, "name");
				if (name) names.add(name.text);
			}
		}
		const value = field(stmt, "value");
		if (value?.type === "identifier") names.add(value.text);
	}
	return names;
}

/** `a`, `this`, `a.b.c` — or null when the expression is not a plain name path. */
export function namePath(node: Node): string | null {
	switch (node.type) {
		case "identifier":
		case "this":
		case "super":
		case "property_identifier":
		case "type_identifier":
			return node.text;
		case "member_expression":
		case "nested_identifier":
		case "nested_type_identifier": {
			const object = node.namedChildren[0];
			const property = node.namedChildren[node.namedChildren.length - 1];
			if (!object || !property || object.id === property.id) return null;
			const head = namePath(object);
			return head === null ? null : `${head}.${property.text}`;
		}
		default:
			return null;
	}
}

/** The value of a string literal, or of a template literal with no substitutions. */
export function stringValue(node: Node | null | undefined): string | null {
	if (!node) return null;
	if (node.type === "string") return unquote(node);
	if (
		node.type === "template_string" &&
		!namedKids(node).some((k) => k.type === "template_substitution")
	) {
		return unquote(node);
	}
	return null;
}

/** `describe`/`test`/`it` (with modifiers such as `.skip` or `.each(table)`), or null. */
export function testKind(callee: Node): "suite" | "case" | null {
	const target =
		callee.type === "call_expression" ? field(callee, "function") : callee;
	const path = target ? namePath(target) : null;
	if (path === null) return null;
	const [root, ...modifiers] = path.split(".");
	if (!root || !modifiers.every((m) => TEST_MODIFIERS.has(m))) return null;
	if (SUITE_NAMES.has(root)) return "suite";
	if (CASE_NAMES.has(root)) return "case";
	return null;
}

function specifierBindings(list: Node): readonly ImportBinding[] {
	return namedKids(list).flatMap((spec) => {
		const name = field(spec, "name");
		if (!name) return [];
		const alias = field(spec, "alias");
		return [{ name: name.text, alias: alias?.text ?? null }];
	});
}

/** An `import …` statement, including TS `import fs = require(…)`. */
export function importStatement(sink: Sink, node: Node): void {
	const typeOnly = hasToken(node, "type");
	const names: ImportBinding[] = [];
	for (const kid of namedKids(node)) {
		if (kid.type === "import_require_clause") {
			const alias = namedKids(kid).find((k) => k.type === "identifier");
			const required = stringValue(field(kid, "source"));
			if (required !== null) {
				addImport(sink, node, {
					source: required,
					names: [{ name: "*", alias: alias?.text ?? null }],
					typeOnly,
				});
			}
			return;
		}
		if (kid.type !== "import_clause") continue;
		for (const part of namedKids(kid)) {
			if (part.type === "identifier") {
				names.push({ name: "default", alias: part.text });
			} else if (part.type === "namespace_import") {
				const alias = namedKids(part).find((k) => k.type === "identifier");
				names.push({ name: "*", alias: alias?.text ?? null });
			} else if (part.type === "named_imports") {
				names.push(...specifierBindings(part));
			}
		}
	}
	const source = stringValue(field(node, "source"));
	if (source !== null) addImport(sink, node, { source, names, typeOnly });
}

/**
 * Records `export … from "…"` as a re-export and returns true; returns false
 * for a local export, which the walker handles as a declaration.
 */
export function reexportStatement(sink: Sink, node: Node): boolean {
	const source = stringValue(field(node, "source"));
	if (source === null) return false;
	const clause = namedKids(node).find(
		(k) => k.type === "export_clause" || k.type === "namespace_export",
	);
	const names: readonly ImportBinding[] =
		clause === undefined
			? [{ name: "*", alias: null }]
			: clause.type === "namespace_export"
				? [{ name: "*", alias: namedKids(clause)[0]?.text ?? null }]
				: specifierBindings(clause);
	addImport(sink, node, {
		source,
		names,
		kind: "reexport",
		typeOnly: hasToken(node, "type"),
	});
	return true;
}
