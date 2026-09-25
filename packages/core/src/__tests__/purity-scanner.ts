/**
 * Static scanner behind the functional-core purity ratchet (issue #289).
 *
 * It masks comments, string literals, template-literal text and regex
 * literals (keeping newlines so line numbers survive), then matches the
 * forbidden constructs on what is left. Besides direct member access it
 * catches Bun's aliases (`Bun.env`, `Bun.stdout`), destructuring
 * (`const { env } = process`, `const { log } = console`) and named imports
 * from `process` / `node:process`. It is a lexer, not a type checker:
 * computed access such as `process["env"]` and aliasing through another
 * binding (`const p = process; p.env`) are out of scope.
 */

export type PurityRule =
	| "process.cwd"
	| "process.env"
	| "process.stdout"
	| "console"
	| "throw";

export type PurityViolation = Readonly<{ rule: PurityRule; line: number }>;

/*
 * Every pattern starts with the same two lookbehinds: not after an
 * identifier character, and not after a member-access dot (`a.process`)
 * while still allowing the spread operator (`...process.env`). An optional
 * `globalThis.` prefix and `?.` optional chaining are accepted; `Bun.env`
 * and `Bun.stdout` count as `process.env` and `process.stdout`.
 */
const RULES: ReadonlyArray<readonly [PurityRule, RegExp]> = [
	[
		"process.cwd",
		/(?<![\w$])(?<!(?:^|[^.])\.)(?:globalThis\s*\??\.\s*)?process\s*\??\.\s*cwd\b/gm,
	],
	[
		"process.env",
		/(?<![\w$])(?<!(?:^|[^.])\.)(?:(?:globalThis\s*\??\.\s*)?process|Bun)\s*\??\.\s*env\b/gm,
	],
	[
		"process.stdout",
		/(?<![\w$])(?<!(?:^|[^.])\.)(?:(?:globalThis\s*\??\.\s*)?process|Bun)\s*\??\.\s*stdout\b/gm,
	],
	[
		"console",
		/(?<![\w$])(?<!(?:^|[^.])\.)(?:globalThis\s*\??\.\s*)?console\s*\??\.\s*[\w$]/gm,
	],
	["throw", /(?<![\w$])(?<!(?:^|[^.])\.)throw\b/gm],
];

/** Keywords after which a `/` starts a regex literal rather than a division. */
const REGEX_AFTER_WORD = new Set([
	"return",
	"typeof",
	"instanceof",
	"case",
	"do",
	"else",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"yield",
	"await",
]);

const REGEX_AFTER_CHAR = new Set("(,=:[!&|?{};+-*%<>~^".split(""));

function blank(ch: string): string {
	return ch === "\n" ? "\n" : " ";
}

/** Keywords whose `( … )` header can be followed directly by a statement. */
const CONTROL_KEYWORDS = new Set(["if", "while", "for", "with"]);

function lastSignificant(code: readonly string[]): number {
	let i = code.length - 1;
	while (i >= 0 && /\s/.test(code[i] ?? "")) i--;
	return i;
}

function wordEndingAt(code: readonly string[], end: number): string {
	let start = end;
	while (start > 0 && /[\w$]/.test(code[start - 1] ?? "")) start--;
	return code.slice(start, end + 1).join("");
}

/**
 * Whether a `/` at the current position starts a regex literal.
 * `controlCloses` holds the output indices of `)` that close an
 * `if`/`while`/`for`/`with` header, after which a statement (and therefore
 * a regex) may start; after any other `)` a `/` is a division.
 */
function regexAllowed(
	code: readonly string[],
	controlCloses: ReadonlySet<number>,
): boolean {
	const i = lastSignificant(code);
	if (i < 0) return true;
	const last = code[i] ?? "";
	if (last === ")") return controlCloses.has(i);
	if (REGEX_AFTER_CHAR.has(last)) return true;
	if (!/[\w$]/.test(last)) return false;
	return REGEX_AFTER_WORD.has(wordEndingAt(code, i));
}

/**
 * Index just past the `/` that closes a regex literal starting at `start`,
 * or -1 when the line ends first (then the `/` is not a regex).
 */
function regexEnd(source: string, start: number): number {
	let inClass = false;
	let i = start + 1;
	while (i < source.length && source[i] !== "\n") {
		const c = source[i];
		if (c === "\\") {
			i += 2;
			continue;
		}
		i++;
		if (c === "[") inClass = true;
		else if (c === "]") inClass = false;
		else if (c === "/" && !inClass) return i;
	}
	return -1;
}

/**
 * Replace comments, string contents, template text and regex literals with
 * spaces. Code inside `${…}` template expressions is kept.
 */
function maskNonCode(source: string): string {
	const out: string[] = [];
	// Each entry is the brace depth at which a `${` expression was opened.
	const templateStack: number[] = [];
	// One entry per open `(`: whether it opened a control-flow header.
	const parenStack: boolean[] = [];
	const controlCloses = new Set<number>();
	let depth = 0;
	let i = 0;

	const readTemplate = (): void => {
		// Called with `i` on the first char after the opening backtick or `}`.
		while (i < source.length) {
			const ch = source[i] ?? "";
			if (ch === "\\") {
				out.push(" ", blank(source[i + 1] ?? ""));
				i += 2;
			} else if (ch === "`") {
				out.push("`");
				i++;
				return;
			} else if (ch === "$" && source[i + 1] === "{") {
				out.push("${");
				i += 2;
				templateStack.push(depth);
				depth++;
				return;
			} else {
				out.push(blank(ch));
				i++;
			}
		}
	};

	while (i < source.length) {
		const ch = source[i] ?? "";
		const next = source[i + 1] ?? "";

		if (ch === "/" && next === "/") {
			while (i < source.length && source[i] !== "\n") {
				out.push(" ");
				i++;
			}
		} else if (ch === "/" && next === "*") {
			const end = source.indexOf("*/", i + 2);
			const stop = end === -1 ? source.length : end + 2;
			for (; i < stop; i++) out.push(blank(source[i] ?? ""));
		} else if (ch === "'" || ch === '"') {
			out.push(ch);
			i++;
			while (i < source.length && source[i] !== ch && source[i] !== "\n") {
				if (source[i] === "\\") {
					out.push(" ");
					i++;
				}
				out.push(blank(source[i] ?? ""));
				i++;
			}
			if (i < source.length) {
				out.push(blank(source[i] ?? ""));
				i++;
			}
		} else if (ch === "`") {
			out.push("`");
			i++;
			readTemplate();
		} else if (ch === "/" && regexAllowed(out, controlCloses)) {
			// Only a `/` closed on the same line is a regex literal; otherwise
			// it is a division (e.g. `i++ / 2`) and the rest of the line stays
			// visible, so a misread never hides code (fail closed).
			const end = regexEnd(source, i);
			if (end === -1) {
				out.push(ch);
				i++;
			} else {
				for (; i < end; i++) out.push(" ");
			}
		} else if (ch === "(") {
			const prev = lastSignificant(out);
			parenStack.push(
				prev >= 0 && CONTROL_KEYWORDS.has(wordEndingAt(out, prev)),
			);
			out.push(ch);
			i++;
		} else if (ch === ")") {
			if (parenStack.pop() === true) controlCloses.add(out.length);
			out.push(ch);
			i++;
		} else if (ch === "{") {
			depth++;
			out.push(ch);
			i++;
		} else if (ch === "}") {
			depth--;
			out.push(ch);
			i++;
			if (templateStack.length > 0 && templateStack.at(-1) === depth) {
				templateStack.pop();
				readTemplate();
			}
		} else {
			out.push(ch);
			i++;
		}
	}
	return out.join("");
}

/** `process` members that map to a rule when bound by name. */
const PROCESS_MEMBERS: ReadonlyMap<string, PurityRule> = new Map([
	["cwd", "process.cwd"],
	["env", "process.env"],
	["stdout", "process.stdout"],
]);

type IndexedViolation = Readonly<{ rule: PurityRule; index: number }>;

/** Property keys named in a `{ … }` binding list (`a`, `b: c`, `d = 1`, `e as f`). */
function boundKeys(list: string): readonly string[] {
	return list
		.split(",")
		.map((entry) =>
			(entry.trim().split(/\s+as\s+|\s*[:=]/)[0] ?? "")
				.replace(/^type\s+/, "")
				.trim(),
		)
		.filter((key) => key.length > 0);
}

/**
 * Destructuring (`const { env } = process`, `{ log } = console`) and named
 * imports from `process` / `node:process`. `code` is the masked source (same
 * indices as `source`), so matches inside comments or strings never count;
 * the module specifier is read from `source` because masking blanks it.
 */
function bindingViolations(
	source: string,
	code: string,
): readonly IndexedViolation[] {
	const fromProcess = (keys: readonly string[], index: number) =>
		keys.flatMap((key) => {
			const rule = PROCESS_MEMBERS.get(key);
			return rule === undefined ? [] : [{ rule, index }];
		});

	const destructured = [
		...code.matchAll(
			/\{([^{}]*)\}\s*=\s*(?:globalThis\s*\??\.\s*)?(process|console)\b(?!\s*\??\.)/g,
		),
	].flatMap((m): IndexedViolation[] => {
		const index = m.index ?? 0;
		if (m[2] === "console") return [{ rule: "console", index }];
		return fromProcess(boundKeys(m[1] ?? ""), index);
	});

	const imported = [
		...code.matchAll(/(?<![\w$.])import\s*\{([^{}]*)\}\s*from\s*["']/g),
	].flatMap((m) => {
		const index = m.index ?? 0;
		const quote = index + m[0].length - 1;
		return /^["'](?:node:)?process["']/.test(source.slice(quote, quote + 16))
			? fromProcess(boundKeys(m[1] ?? ""), index)
			: [];
	});

	return [...destructured, ...imported];
}

/** Find every forbidden construct in `source`, ordered by position. */
export function scanSource(source: string): readonly PurityViolation[] {
	const code = maskNonCode(source);
	const lineStarts = [0];
	for (let i = 0; i < code.length; i++) {
		if (code[i] === "\n") lineStarts.push(i + 1);
	}
	const lineOf = (index: number): number => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((lineStarts[mid] ?? 0) <= index) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	};

	const direct = RULES.flatMap(([rule, pattern]) =>
		[...code.matchAll(pattern)].map((m) => ({ rule, index: m.index ?? 0 })),
	);
	return [...direct, ...bindingViolations(source, code)]
		.map(({ rule, index }) => ({ rule, index, line: lineOf(index) }))
		.sort((a, b) => a.index - b.index)
		.map(({ rule, line }) => ({ rule, line }));
}
