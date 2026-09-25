/**
 * Parser layer (v1 task 5.1, FR-GRAPH-1 / FR-GRAPH-6): parses one source file
 * in-process with tree-sitter compiled to WebAssembly and extracts symbols,
 * imports, calls, type references and tests. See ADR 0046.
 *
 * `parseFile` never throws. A syntax error still yields a `ParsedFile` with
 * whatever the parser recovered plus the error locations; only a missing
 * grammar or an unknown language is an error value.
 *
 * The grammars ship inside the `@vscode/tree-sitter-wasm` package and are
 * loaded once per process on first use, like any other module code.
 */

import type * as TreeSitter from "@vscode/tree-sitter-wasm";
import type { Result } from "../../db/index";
import { type LoadedGrammar, loadGrammar } from "../../tree-sitter";
import { extract } from "./extract";
import { detectLang, GRAMMAR_FILES } from "./languages";
import type { Lang, ParsedFile, ParseError } from "./types";

export { detectLang, isTestPath } from "./languages";
export type * from "./types";

const message = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// The runtime and each grammar load once per process (see `tree-sitter.ts`).
async function grammar(lang: Lang): Promise<Result<LoadedGrammar, ParseError>> {
	const loaded = await loadGrammar(GRAMMAR_FILES[lang]);
	return loaded.ok
		? loaded
		: {
				ok: false,
				error: { kind: "grammar_load_failed", lang, message: loaded.error },
			};
}

/**
 * Parses `content` as the file at `path`. `lang` overrides the grammar the
 * extension would pick. Paths are only used for the language, the test-file
 * convention and the `path` field; nothing is read from disk.
 */
export async function parseFile(
	path: string,
	content: string,
	lang?: Lang,
): Promise<Result<ParsedFile, ParseError>> {
	const resolved = lang ?? detectLang(path);
	if (resolved === null) {
		return { ok: false, error: { kind: "unsupported_language", path } };
	}
	const loaded = await grammar(resolved);
	if (!loaded.ok) return loaded;

	const { runtime: ts, language } = loaded.value;
	// Constructed inside the guard: a WASM failure here must stay an error value.
	let parser: TreeSitter.Parser | null = null;
	try {
		parser = new ts.Parser();
		parser.setLanguage(language);
		const tree = parser.parse(content);
		if (tree === null) {
			return {
				ok: false,
				error: {
					kind: "parse_failed",
					path,
					message: "parser returned no tree",
				},
			};
		}
		try {
			const parsed = extract(tree.rootNode, path, resolved);
			return parsed.ok
				? parsed
				: {
						ok: false,
						error: { kind: "parse_failed", path, message: parsed.error },
					};
		} finally {
			tree.delete();
		}
	} catch (e) {
		return {
			ok: false,
			error: { kind: "parse_failed", path, message: message(e) },
		};
	} finally {
		parser?.delete();
	}
}
