/**
 * Turns a syntax tree into a `ParsedFile`. Each language has its own walker
 * under `lang/`; they share the node helpers and the sink in `nodes.ts`.
 *
 * Walkers never stop at a syntax error: ERROR nodes are walked like any other
 * node, so everything the parser recovered is still extracted, and the error
 * locations are reported separately in `errors`.
 */

import type { Result } from "../../db/index";
import { extractGo } from "./lang/go";
import { extractJava } from "./lang/java";
import { extractJs } from "./lang/js";
import { extractPython } from "./lang/python";
import { extractRust } from "./lang/rust";
import { isTestPath } from "./languages";
import { collectErrors, type Node, newSink, type Sink, spanOf } from "./nodes";
import type { Lang, ParsedFile, SyntaxIssue } from "./types";

function extractorFor(lang: Lang): (root: Node, sink: Sink) => void {
	switch (lang) {
		case "typescript":
		case "tsx":
		case "javascript":
			return extractJs;
		case "python":
			return extractPython;
		case "go":
			return extractGo;
		case "rust":
			return extractRust;
		case "java":
			return extractJava;
		default: {
			const unreachable: never = lang;
			return unreachable;
		}
	}
}

/**
 * Walkers recurse, so a pathologically deep tree (tens of thousands of nested
 * parentheses) can exhaust the stack. What was collected before that point is
 * kept and a `limit` issue says the results are partial. Any other failure is
 * a bug and becomes an error value.
 */
export function extract(
	root: Node,
	path: string,
	lang: Lang,
): Result<ParsedFile, string> {
	const sink = newSink();
	const issues: SyntaxIssue[] = [];
	try {
		extractorFor(lang)(root, sink);
	} catch (e) {
		if (!(e instanceof RangeError)) {
			return { ok: false, error: e instanceof Error ? e.message : String(e) };
		}
		issues.push({
			kind: "limit",
			text: "nesting too deep to extract; results are partial",
			span: spanOf(root),
		});
	}
	if (root.hasError) issues.unshift(...collectErrors(root));
	return {
		ok: true,
		value: {
			path,
			lang,
			...sink,
			isTestFile: isTestPath(path, lang),
			errors: issues,
		},
	};
}
