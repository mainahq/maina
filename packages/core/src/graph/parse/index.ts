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

import { createRequire } from "node:module";
import type * as TreeSitter from "@vscode/tree-sitter-wasm";
import type { Result } from "../../db/index";
import { extract } from "./extract";
import { detectLang, GRAMMAR_FILES } from "./languages";
import type { Lang, ParsedFile, ParseError } from "./types";

export { detectLang, isTestPath } from "./languages";
export type * from "./types";

type Runtime = typeof TreeSitter;
type Grammar = Readonly<{ runtime: Runtime; language: TreeSitter.Language }>;

const message = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// The package is a UMD bundle whose named exports Node's ESM loader cannot
// see, so it is loaded with `require`, which behaves the same under Bun, Node
// and the bundled build. Loading it lazily means a broken install fails
// `parseFile` with an error value instead of failing every import of core.
const requireHere = createRequire(import.meta.url);

let runtime: Promise<Result<Runtime, string>> | null = null;
const grammars = new Map<Lang, Promise<Result<Grammar, ParseError>>>();

function initRuntime(): Promise<Result<Runtime, string>> {
	runtime ??= (async (): Promise<Result<Runtime, string>> => {
		try {
			const loaded = requireHere("@vscode/tree-sitter-wasm") as Runtime;
			await loaded.Parser.init();
			return { ok: true, value: loaded };
		} catch (e) {
			return { ok: false, error: message(e) };
		}
	})();
	return runtime;
}

async function loadGrammar(lang: Lang): Promise<Result<Grammar, ParseError>> {
	const ts = await initRuntime();
	if (!ts.ok) {
		return {
			ok: false,
			error: { kind: "grammar_load_failed", lang, message: ts.error },
		};
	}
	try {
		const file = requireHere.resolve(
			`@vscode/tree-sitter-wasm/wasm/${GRAMMAR_FILES[lang]}`,
		);
		const language = await ts.value.Language.load(file);
		return { ok: true, value: { runtime: ts.value, language } };
	} catch (e) {
		return {
			ok: false,
			error: { kind: "grammar_load_failed", lang, message: message(e) },
		};
	}
}

function grammar(lang: Lang): Promise<Result<Grammar, ParseError>> {
	let loaded = grammars.get(lang);
	if (loaded === undefined) {
		loaded = loadGrammar(lang);
		grammars.set(lang, loaded);
	}
	return loaded;
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
	const parser = new ts.Parser();
	try {
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
		parser.delete();
	}
}
