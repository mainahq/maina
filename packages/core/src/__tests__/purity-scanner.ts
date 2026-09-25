/**
 * Static scanner behind the functional-core purity ratchet (issue #289).
 *
 * It masks comments, string literals, template-literal text and regex
 * literals (keeping newlines so line numbers survive), then matches the
 * forbidden constructs on what is left. It is a lexer, not a type checker:
 * computed access such as `process["env"]` is out of scope.
 */

export type PurityRule =
	| "process.cwd"
	| "process.env"
	| "process.stdout"
	| "console"
	| "throw";

export type PurityViolation = Readonly<{ rule: PurityRule; line: number }>;

/**
 * Not an identifier character and not a member-access dot (`a.process`),
 * while still allowing the spread operator (`...process.env`).
 */
const START = String.raw`(?<![\w$])(?<!(?:^|[^.])\.)`;
const GLOBAL = String.raw`(?:globalThis\s*\??\.\s*)?`;
const MEMBER = String.raw`\s*\??\.\s*`;

function rule(body: string): RegExp {
	return new RegExp(START + body, "gm");
}

const RULES: ReadonlyArray<readonly [PurityRule, RegExp]> = [
	["process.cwd", rule(String.raw`${GLOBAL}process${MEMBER}cwd\b`)],
	["process.env", rule(String.raw`${GLOBAL}process${MEMBER}env\b`)],
	["process.stdout", rule(String.raw`${GLOBAL}process${MEMBER}stdout\b`)],
	["console", rule(String.raw`${GLOBAL}console${MEMBER}[\w$]`)],
	["throw", rule(String.raw`throw\b`)],
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

function regexAllowed(code: readonly string[]): boolean {
	let i = code.length - 1;
	while (i >= 0 && /\s/.test(code[i] ?? "")) i--;
	if (i < 0) return true;
	const last = code[i] ?? "";
	if (REGEX_AFTER_CHAR.has(last)) return true;
	if (!/[\w$]/.test(last)) return false;
	let start = i;
	while (start > 0 && /[\w$]/.test(code[start - 1] ?? "")) start--;
	return REGEX_AFTER_WORD.has(code.slice(start, i + 1).join(""));
}

/**
 * Replace comments, string contents, template text and regex literals with
 * spaces. Code inside `${…}` template expressions is kept.
 */
export function maskNonCode(source: string): string {
	const out: string[] = [];
	// Each entry is the brace depth at which a `${` expression was opened.
	const templateStack: number[] = [];
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
		} else if (ch === "/" && regexAllowed(out)) {
			out.push(" ");
			i++;
			let inClass = false;
			while (i < source.length && source[i] !== "\n") {
				const c = source[i] ?? "";
				if (c === "\\") {
					out.push(" ", blank(source[i + 1] ?? ""));
					i += 2;
					continue;
				}
				out.push(" ");
				i++;
				if (c === "[") inClass = true;
				else if (c === "]") inClass = false;
				else if (c === "/" && !inClass) break;
			}
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

	return RULES.flatMap(([rule, pattern]) =>
		[...code.matchAll(pattern)].map((m) => ({
			rule,
			line: lineOf(m.index ?? 0),
			index: m.index ?? 0,
		})),
	)
		.sort((a, b) => a.index - b.index)
		.map(({ rule, line }) => ({ rule, line }));
}
