/**
 * Bash parser for the gate (FR-GATE-2). See ADR 0047.
 *
 * tree-sitter-bash (WebAssembly, from `@vscode/tree-sitter-wasm`) builds the
 * syntax tree; this module turns it into a small, plain, readonly tree the
 * classifier walks. Nothing here decides anything: it only says what the
 * words, commands, pipelines, redirects and substitutions are.
 *
 * - Quoting is resolved: `r''m`, `\rm` and `$'\x72\x6d'` are all the text
 *   `rm`. Expansions (`$X`, `${X:-y}`, `$(…)`, `<(…)`) stay structured parts,
 *   so the classifier can resolve what it knows and treat the rest as
 *   unknown.
 * - A syntax error is data: `errors` lists it and everything the parser
 *   recovered is still returned. `parse` never throws; only a WebAssembly
 *   failure is an error value.
 */

import type { Node, Parser } from "@vscode/tree-sitter-wasm";
import type { Result } from "../../db/index";
import { loadGrammar } from "../../tree-sitter";

// ── The tree ────────────────────────────────────────────────────────────────

export type WordPart =
	| Readonly<{ kind: "text"; text: string; quoted: boolean }>
	/** `$X`, `${X}`, `${X:-fallback}`; `quoted` when inside double quotes. */
	| Readonly<{
			kind: "param";
			name: string;
			quoted: boolean;
			fallback: ShellWord | null;
	  }>
	/** `$(…)` or backticks. */
	| Readonly<{ kind: "subst"; script: ShellScript; quoted: boolean }>
	/** `<(…)` / `>(…)`. */
	| Readonly<{
			kind: "procsubst";
			script: ShellScript;
			direction: "in" | "out";
	  }>
	/**
	 * Arithmetic, `${#X}`, `${X/a/b}`, arrays and other forms whose value is
	 * unknown. `scripts` are the substitutions nested inside it, which still
	 * run (`${X/a/$(…)}`, `$(( $(…) ))`, `( $(…) )`).
	 */
	| Readonly<{ kind: "opaque"; raw: string; scripts: readonly ShellScript[] }>;

export type ShellWord = Readonly<{ raw: string; parts: readonly WordPart[] }>;

export type Assignment = Readonly<{ name: string; value: ShellWord | null }>;

export type Redirect =
	/** `>`, `>>`, `&>`, `>|`, `<`, `<>`; `fd` is the explicit descriptor, if any. */
	| Readonly<{ kind: "file"; op: string; fd: number | null; target: ShellWord }>
	/** Descriptor duplication (`2>&1`, `<&-`): no file is touched. */
	| Readonly<{ kind: "dup"; op: string; fd: number | null; target: string }>
	/**
	 * `<<EOF` / `<<-EOF`; `expands` is false for a quoted delimiter. An
	 * expanding body runs its substitutions: `substs` are the parsed `$(…)`
	 * ones, `backticks` the source of each `` `…` `` (tree-sitter-bash leaves
	 * those as text inside a heredoc, so the caller parses them).
	 */
	| Readonly<{
			kind: "heredoc";
			body: string;
			expands: boolean;
			substs: readonly ShellScript[];
			backticks: readonly string[];
	  }>
	| Readonly<{ kind: "herestring"; word: ShellWord }>;

export type ShellNode =
	| Readonly<{
			kind: "command";
			argv: readonly ShellWord[];
			/** Prefix assignments (`FOO=1 cmd`). */
			assignments: readonly Assignment[];
			redirects: readonly Redirect[];
	  }>
	/** `X=1`, `export X=1`, `local`, `declare`, `readonly`, `unset`. */
	| Readonly<{
			kind: "assign";
			keyword: string | null;
			assignments: readonly Assignment[];
	  }>
	| Readonly<{ kind: "pipeline"; stages: readonly ShellNode[] }>
	/**
	 * Statements run in order: lists, groups, subshells, conditionals, case
	 * arms. Every branch is included; the gate cannot know which one runs.
	 */
	| Readonly<{
			kind: "sequence";
			nodes: readonly ShellNode[];
			redirects: readonly Redirect[];
	  }>
	| Readonly<{ kind: "function"; name: string; body: ShellNode }>
	/** `for x in …` / `select`; `items` is null for an implicit `"$@"`. */
	| Readonly<{
			kind: "loop";
			variable: string;
			items: readonly ShellWord[] | null;
			body: ShellNode;
	  }>
	/** Text the parser could not make sense of. */
	| Readonly<{ kind: "unknown"; raw: string }>;

export type ShellScript = Readonly<{
	nodes: readonly ShellNode[];
	/** Text of every syntax error and missing token; empty for clean input. */
	errors: readonly string[];
}>;

export type ShellParseError = Readonly<{
	kind: "parse_failed";
	message: string;
}>;
export type ShellParserLoadError = Readonly<{
	kind: "grammar_load_failed";
	message: string;
}>;

export type ShellParser = Readonly<{
	parse: (source: string) => Result<ShellScript, ShellParseError>;
}>;

/** The word's text when it is fully literal; null when any part is dynamic. */
export function literalText(word: ShellWord): string | null {
	let text = "";
	for (const part of word.parts) {
		if (part.kind !== "text") return null;
		text += part.text;
	}
	return text;
}

// ── Loading ─────────────────────────────────────────────────────────────────

const GRAMMAR_FILE = "tree-sitter-bash.wasm";

const message = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

let loading: Promise<Result<ShellParser, ShellParserLoadError>> | null = null;

/**
 * Loads the bash grammar once per process and returns a synchronous parser.
 * The gate needs a decision in milliseconds, so the only async step, loading
 * WebAssembly, happens once up front.
 */
export function loadShellParser(): Promise<
	Result<ShellParser, ShellParserLoadError>
> {
	loading ??= (async (): Promise<Result<ShellParser, ShellParserLoadError>> => {
		const grammar = await loadGrammar(GRAMMAR_FILE);
		if (!grammar.ok) {
			return {
				ok: false,
				error: { kind: "grammar_load_failed", message: grammar.error },
			};
		}
		try {
			const parser = new grammar.value.runtime.Parser();
			parser.setLanguage(grammar.value.language);
			return { ok: true, value: { parse: (s) => parseWith(parser, s) } };
		} catch (e) {
			return {
				ok: false,
				error: { kind: "grammar_load_failed", message: message(e) },
			};
		}
	})();
	return loading;
}

function parseWith(
	parser: Parser,
	source: string,
): Result<ShellScript, ShellParseError> {
	try {
		const tree = parser.parse(source);
		if (tree === null) {
			return {
				ok: false,
				error: { kind: "parse_failed", message: "parser returned no tree" },
			};
		}
		try {
			return { ok: true, value: script(tree.rootNode) };
		} finally {
			tree.delete();
		}
	} catch (e) {
		return { ok: false, error: { kind: "parse_failed", message: message(e) } };
	}
}

// ── Syntax tree → gate tree ────────────────────────────────────────────────

const named = (node: Node): readonly Node[] =>
	node.namedChildren.filter((c): c is Node => c !== null);

const all = (node: Node): readonly Node[] =>
	node.children.filter((c): c is Node => c !== null);

const REDIRECTS: ReadonlySet<string> = new Set([
	"file_redirect",
	"heredoc_redirect",
	"herestring_redirect",
]);

/** Brace expansion in command position (`{rm,-rf,/}`) is a syntax error to tree-sitter. */
const BRACE_COMMAND = /^\{([^{}\s]*,[^{}\s]*)\}$/;

function script(root: Node): ShellScript {
	return { nodes: statements(root), errors: syntaxErrors(root) };
}

function syntaxErrors(root: Node): readonly string[] {
	if (!root.hasError) return [];
	const errors: string[] = [];
	const stack: Node[] = [root];
	while (stack.length > 0) {
		const node = stack.pop() as Node;
		if (node.type === "ERROR" && BRACE_COMMAND.test(node.text)) continue;
		if (node.isError || node.isMissing) {
			errors.push(node.isMissing ? `missing ${node.type}` : node.text);
			continue;
		}
		if (node.hasError) stack.push(...all(node));
	}
	return errors;
}

function statements(parent: Node): readonly ShellNode[] {
	return named(parent).flatMap((child) => {
		if (child.type === "list") return statements(child);
		const node = statement(child);
		return node === null ? [] : [node];
	});
}

function sequence(
	nodes: readonly ShellNode[],
	redirects: readonly Redirect[] = [],
): ShellNode {
	return { kind: "sequence", nodes, redirects };
}

function statement(node: Node): ShellNode | null {
	switch (node.type) {
		case "comment":
			return null;
		case "command":
			return command(node);
		case "redirected_statement":
			return redirected(node);
		case "variable_assignment":
			return { kind: "assign", keyword: null, assignments: [assignment(node)] };
		case "variable_assignments":
			return {
				kind: "assign",
				keyword: null,
				assignments: named(node)
					.filter((c) => c.type === "variable_assignment")
					.map(assignment),
			};
		case "declaration_command":
		case "unset_command":
			return declaration(node);
		case "pipeline":
			return {
				kind: "pipeline",
				stages: named(node).flatMap((c) => {
					const s = statement(c);
					return s === null ? [] : [s];
				}),
			};
		case "function_definition":
			return functionDef(node);
		case "for_statement":
			return loop(node);
		case "ERROR":
			return errorNode(node);
		default:
			// Groups, subshells, conditionals, loops, case arms and test
			// commands: every statement inside, plus any substitution hidden in
			// their words (`[[ -f $(rm x) ]]`, `case $(…) in`).
			return sequence(statements(node));
	}
}

function command(node: Node, extra: readonly Redirect[] = []): ShellNode {
	const argv: ShellWord[] = [];
	const assignments: Assignment[] = [];
	const redirects: Redirect[] = [];
	for (const child of named(node)) {
		if (child.type === "variable_assignment") {
			assignments.push(assignment(child));
		} else if (child.type === "command_name") {
			const inner = named(child)[0];
			if (inner) argv.push(word(inner));
		} else if (REDIRECTS.has(child.type)) {
			redirects.push(...redirect(child).redirects);
		} else if (child.type !== "comment") {
			argv.push(word(child));
		}
	}
	return {
		kind: "command",
		argv,
		assignments,
		redirects: [...redirects, ...extra],
	};
}

function redirected(node: Node): ShellNode {
	const redirects: Redirect[] = [];
	// A heredoc can carry the rest of its line: `cat <<EOF | sh`.
	const trailing: ShellNode[] = [];
	for (const child of node.childrenForFieldName("redirect")) {
		if (child === null) continue;
		const r = redirect(child);
		redirects.push(...r.redirects);
		trailing.push(...r.trailing);
	}
	const body = node.childForFieldName("body");
	const head: ShellNode =
		body === null
			? { kind: "command", argv: [], assignments: [], redirects }
			: body.type === "command"
				? command(body, redirects)
				: sequence(
						[statement(body)].filter((s) => s !== null),
						redirects,
					);
	if (trailing.length === 0) return head;
	const [first, ...rest] = trailing;
	return first?.kind === "pipeline"
		? sequence([{ kind: "pipeline", stages: [head, ...first.stages] }, ...rest])
		: sequence([head, ...trailing]);
}

type RedirectParts = Readonly<{
	redirects: readonly Redirect[];
	trailing: readonly ShellNode[];
}>;

function redirect(node: Node): RedirectParts {
	switch (node.type) {
		case "file_redirect": {
			const fdNode = node.childForFieldName("descriptor");
			const fd = fdNode === null ? null : Number.parseInt(fdNode.text, 10);
			const op =
				all(node).find((c) => !c.isNamed && c.type !== "file_descriptor")
					?.type ?? ">";
			const dest = node.childForFieldName("destination");
			if (dest === null) return { redirects: [], trailing: [] };
			const isDup = (op === ">&" || op === "<&") && /^(\d+|-)$/.test(dest.text);
			return {
				redirects: [
					isDup
						? { kind: "dup", op, fd, target: dest.text }
						: { kind: "file", op, fd, target: word(dest) },
				],
				trailing: [],
			};
		}
		case "heredoc_redirect": {
			const start = named(node).find((c) => c.type === "heredoc_start");
			const bodyNode = named(node).find((c) => c.type === "heredoc_body");
			const stripTabs = all(node).some((c) => c.type === "<<-");
			const raw = bodyNode?.text ?? "";
			const body = stripTabs ? raw.replace(/^\t+/gm, "") : raw;
			const expands = !/['"\\]/.test(start?.text ?? "");
			const heredoc: Redirect = {
				kind: "heredoc",
				body,
				expands,
				substs: expands && bodyNode ? nestedScripts(bodyNode) : [],
				backticks: expands ? backtickSources(raw) : [],
			};
			const inner = named(node).filter(
				(c) =>
					c.type !== "heredoc_start" &&
					c.type !== "heredoc_body" &&
					c.type !== "heredoc_end",
			);
			const more = inner.filter((c) => REDIRECTS.has(c.type)).map(redirect);
			const trailing = inner
				.filter((c) => !REDIRECTS.has(c.type))
				.flatMap((c) => {
					const s = statement(c);
					return s === null ? [] : [s];
				});
			return {
				redirects: [heredoc, ...more.flatMap((m) => m.redirects)],
				trailing: [...more.flatMap((m) => m.trailing), ...trailing],
			};
		}
		case "herestring_redirect": {
			const target = named(node)[0];
			return {
				redirects: target ? [{ kind: "herestring", word: word(target) }] : [],
				trailing: [],
			};
		}
		default:
			return { redirects: [], trailing: [] };
	}
}

function assignment(node: Node): Assignment {
	const name = node.childForFieldName("name")?.text ?? "";
	const value = node.childForFieldName("value");
	return { name, value: value === null ? null : word(value) };
}

function declaration(node: Node): ShellNode {
	const keyword = all(node).find((c) => !c.isNamed)?.type ?? null;
	const assignments = named(node).flatMap((c): Assignment[] => {
		if (c.type === "variable_assignment") return [assignment(c)];
		if (c.type === "variable_name") return [{ name: c.text, value: null }];
		return [];
	});
	return { kind: "assign", keyword, assignments };
}

function functionDef(node: Node): ShellNode {
	const name = node.childForFieldName("name")?.text ?? "";
	const body = node.childForFieldName("body");
	const inner = body === null ? null : statement(body);
	return { kind: "function", name, body: inner ?? sequence([]) };
}

function loop(node: Node): ShellNode {
	const variable = node.childForFieldName("variable")?.text ?? "";
	const values = node
		.childrenForFieldName("value")
		.filter((c): c is Node => c !== null);
	const hasIn = all(node).some((c) => !c.isNamed && c.type === "in");
	const body = node.childForFieldName("body");
	return {
		kind: "loop",
		variable,
		items: hasIn ? values.map(word) : null,
		body: (body === null ? null : statement(body)) ?? sequence([]),
	};
}

function errorNode(node: Node): ShellNode {
	const brace = BRACE_COMMAND.exec(node.text);
	if (brace) {
		return {
			kind: "command",
			argv: (brace[1] ?? "")
				.split(",")
				.filter((w) => w.length > 0)
				.map((w) => ({
					raw: w,
					parts: [{ kind: "text", text: w, quoted: false }],
				})),
			assignments: [],
			redirects: [],
		};
	}
	// Keep whatever statements the parser recovered around the error.
	return sequence([{ kind: "unknown", raw: node.text }, ...statements(node)]);
}

// ── Words ───────────────────────────────────────────────────────────────────

function word(node: Node): ShellWord {
	return { raw: node.text, parts: parts(node, false) };
}

function parts(node: Node, quoted: boolean): readonly WordPart[] {
	switch (node.type) {
		case "word":
			return [{ kind: "text", text: unescapeUnquoted(node.text), quoted }];
		case "number":
		case "extglob_pattern":
		case "regex":
		case "variable_name":
			return [{ kind: "text", text: node.text, quoted }];
		case "raw_string":
			return [{ kind: "text", text: node.text.slice(1, -1), quoted: true }];
		case "ansi_c_string":
			return [
				{
					kind: "text",
					text: decodeAnsiC(node.text.slice(2, -1)),
					quoted: true,
				},
			];
		case "string":
		case "translated_string":
			return named(node).flatMap((c) =>
				c.type === "string_content"
					? [
							{
								kind: "text" as const,
								text: unescapeDouble(c.text),
								quoted: true,
							},
						]
					: parts(c, true),
			);
		case "concatenation":
			return named(node).flatMap((c) => parts(c, quoted));
		case "simple_expansion": {
			const name = named(node)[0]?.text ?? "";
			return [{ kind: "param", name, quoted, fallback: null }];
		}
		case "expansion":
			return [expansion(node, quoted)];
		case "command_substitution":
			return [{ kind: "subst", script: script(node), quoted }];
		case "process_substitution":
			return [
				{
					kind: "procsubst",
					script: script(node),
					direction: node.text.startsWith(">") ? "out" : "in",
				},
			];
		default:
			return node.namedChildCount === 0 && node.type !== "ERROR"
				? [{ kind: "text", text: node.text, quoted }]
				: [opaque(node)];
	}
}

function opaque(node: Node): WordPart {
	return { kind: "opaque", raw: node.text, scripts: nestedScripts(node) };
}

const SUBSTITUTIONS: ReadonlySet<string> = new Set([
	"command_substitution",
	"process_substitution",
]);

/** Every outermost `$(…)`, backtick or `<(…)` below `node`, as a script. */
function nestedScripts(node: Node): readonly ShellScript[] {
	const found: ShellScript[] = [];
	const stack: Node[] = [...named(node)].reverse();
	while (stack.length > 0) {
		const child = stack.pop() as Node;
		if (SUBSTITUTIONS.has(child.type)) found.push(script(child));
		else stack.push(...[...named(child)].reverse());
	}
	return found;
}

/**
 * The source inside each unescaped `` `…` `` pair of a heredoc body, with the
 * backslash escapes bash removes there (`` \` ``, `\\`, `\$`) undone. An
 * unpaired backtick yields everything after it, so nothing is dropped.
 */
function backtickSources(body: string): readonly string[] {
	const found: string[] = [];
	let current: string | null = null;
	for (let i = 0; i < body.length; i++) {
		const c = body[i] as string;
		if (c === "\\" && i + 1 < body.length) {
			const next = body[i + 1] as string;
			if (current !== null) {
				current +=
					next === "`" || next === "\\" || next === "$" ? next : c + next;
			}
			i++;
		} else if (c === "`") {
			if (current === null) current = "";
			else {
				found.push(current);
				current = null;
			}
		} else if (current !== null) current += c;
	}
	if (current !== null) found.push(current);
	return found;
}

/** Operators whose value is the variable or a literal fallback. */
const FALLBACK_OPS: ReadonlySet<string> = new Set([":-", "-", ":=", "="]);

function expansion(node: Node, quoted: boolean): WordPart {
	const kids = all(node);
	const nameAt = kids.findIndex(
		(c) => c.type === "variable_name" || c.type === "special_variable_name",
	);
	const opAt = kids.findIndex((c, i) => i > 0 && !c.isNamed && c.type !== "}");
	const name = kids[nameAt]?.text;
	if (name === undefined) return opaque(node);
	if (opAt < 0) return { kind: "param", name, quoted, fallback: null };
	const op = kids[opAt]?.type ?? "";
	if (!FALLBACK_OPS.has(op) || opAt < nameAt) {
		return opaque(node);
	}
	const rest = kids.slice(opAt + 1).filter((c) => c.isNamed);
	const fallback: ShellWord = {
		raw: rest.map((c) => c.text).join(""),
		parts: rest.flatMap((c) => parts(c, quoted)),
	};
	return { kind: "param", name, quoted, fallback };
}

/** Outside quotes a backslash quotes the next character; `\<newline>` joins lines. */
function unescapeUnquoted(text: string): string {
	return text.replace(/\\(\n|[\s\S])/g, (_m, c: string) =>
		c === "\n" ? "" : c,
	);
}

/** Inside double quotes a backslash only escapes `$`, `` ` ``, `"`, `\` and newline. */
function unescapeDouble(text: string): string {
	return text.replace(/\\([\\$`"\n])/g, (_m, c: string) =>
		c === "\n" ? "" : c,
	);
}

const ANSI_SIMPLE: Readonly<Record<string, string>> = {
	a: "\x07",
	b: "\b",
	e: "\x1b",
	E: "\x1b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
	v: "\v",
	"\\": "\\",
	"'": "'",
	'"': '"',
	"?": "?",
};

/** Decodes the body of a `$'…'` string. */
function decodeAnsiC(body: string): string {
	return body.replace(
		/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|c.|[\s\S])/g,
		(_m, esc: string) => {
			const head = esc[0] ?? "";
			if (head === "x" || head === "u" || head === "U") {
				// A code point past Unicode cannot be encoded; bash drops it. It
				// must not abort the parse and hide the rest of the command.
				const code = Number.parseInt(esc.slice(1), 16);
				return code <= 0x10ffff ? String.fromCodePoint(code) : "";
			}
			if (/^[0-7]/.test(esc)) {
				return String.fromCharCode(Number.parseInt(esc, 8));
			}
			if (head === "c") {
				return String.fromCharCode((esc.charCodeAt(1) || 0) & 0x1f);
			}
			return ANSI_SIMPLE[esc] ?? `\\${esc}`;
		},
	);
}
