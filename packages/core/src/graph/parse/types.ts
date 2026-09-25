/**
 * Data shapes produced by the parser layer (v1 task 5.1, FR-GRAPH-1).
 *
 * Every value is plain, readonly and JSON-serialisable so the graph builder
 * can cache it. Names are unresolved: a call to `fmt` records `"fmt"`, not
 * the symbol it points at. Resolving names across files is the graph
 * builder's job, not the parser's.
 */

/** Grammars the parser ships. The JavaScript grammar also parses JSX. */
export type Lang =
	| "typescript"
	| "tsx"
	| "javascript"
	| "python"
	| "go"
	| "rust"
	| "java";

/** Source range. Lines are 1-based; columns are 0-based UTF-16 code-unit offsets (JavaScript string indices). */
export type Span = Readonly<{
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}>;

export type SymbolKind =
	| "function"
	| "method"
	| "class"
	| "interface"
	| "type"
	| "enum"
	| "struct"
	| "trait"
	| "module";

export type ParsedSymbol = Readonly<{
	name: string;
	kind: SymbolKind;
	/** Qualified name of the enclosing symbol (`"Circle"` for `Circle.area`), or null at top level. */
	parent: string | null;
	/** `parent.name`, or `name` at top level. Calls, refs and tests use it as their `scope`. */
	qualifiedName: string;
	/** Visible outside the file or module, by the language's own rule. */
	exported: boolean;
	span: Span;
}>;

/**
 * One imported binding. `name` is the exported name (`"default"` for a
 * default import, `"*"` for a namespace or wildcard); `alias` is the local
 * name when it differs.
 */
export type ImportBinding = Readonly<{ name: string; alias: string | null }>;

export type ParsedImport = Readonly<{
	/** Module specifier as written: `"./base"`, `"os.path"`, `"std::io"`, `"java.util"`. */
	source: string;
	/** Empty when nothing is bound by name: side-effect imports, `require()` and dynamic `import()` calls, Go blank imports. */
	names: readonly ImportBinding[];
	/** `reexport` for `export … from` (TS/JS) and `pub use` (Rust). */
	kind: "import" | "reexport";
	typeOnly: boolean;
	span: Span;
}>;

export type CallKind = "call" | "new" | "macro" | "jsx";

export type ParsedCall = Readonly<{
	/** The called name: `"join"` for `path.join(…)`. */
	name: string;
	/** Callee as a dotted path: `"path.join"`, `"this.scale"`, `"Circle::new"`. */
	callee: string;
	/** True for member calls (`a.b()`, `A::b()`). */
	member: boolean;
	/** Receiver text when it is a plain name path (`"this"`, `"path"`, `"a.b"`), else null. */
	receiver: string | null;
	kind: CallKind;
	/** Qualified name of the enclosing symbol, or null at top level. */
	scope: string | null;
	span: Span;
}>;

export type ParsedRef = Readonly<{
	name: string;
	/** `inherit` for extends/implements/base classes/trait impls; `type` for any other type position. */
	kind: "type" | "inherit";
	scope: string | null;
	span: Span;
}>;

export type ParsedTest = Readonly<{
	/** Test title (`describe("greet")` → `"greet"`) or function name (`TestArea`). */
	name: string;
	kind: "suite" | "case";
	/** Enclosing symbol or suite, or null at top level. */
	scope: string | null;
	/**
	 * `scope.name` for symbol-based tests (`TestCircle.test_area`); titles of
	 * nested JS/TS blocks join with `" > "` (`greet > formats the name`).
	 * Calls made inside the test carry it as their `scope`.
	 */
	qualifiedName: string;
	span: Span;
}>;

export type SyntaxIssue = Readonly<{
	/**
	 * `error`: text the grammar could not parse; `missing`: a token the parser
	 * inserted; `limit`: nesting too deep to walk, so extraction stopped there
	 * and the results are partial.
	 */
	kind: "error" | "missing" | "limit";
	/** For `missing`, the inserted token (`"}"`); for `error`, the first line of the skipped text; for `limit`, why extraction stopped. */
	text: string;
	span: Span;
}>;

export type ParsedFile = Readonly<{
	path: string;
	lang: Lang;
	symbols: readonly ParsedSymbol[];
	imports: readonly ParsedImport[];
	calls: readonly ParsedCall[];
	refs: readonly ParsedRef[];
	tests: readonly ParsedTest[];
	/** True when the path follows the language's test-file convention. */
	isTestFile: boolean;
	/** Syntax errors. Extraction still covers everything the parser recovered. */
	errors: readonly SyntaxIssue[];
}>;

export type ParseError =
	| Readonly<{ kind: "unsupported_language"; path: string }>
	| Readonly<{ kind: "grammar_load_failed"; lang: Lang; message: string }>
	| Readonly<{ kind: "parse_failed"; path: string; message: string }>;
