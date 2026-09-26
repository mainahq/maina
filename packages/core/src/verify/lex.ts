/**
 * Line lexer for JavaScript/TypeScript source — a pure, synchronous pass
 * that tells verify checks which columns of a line are code, comment or
 * literal, so text that only *mentions* a pattern (in a string, template,
 * regex literal or comment) is not read as the pattern itself.
 *
 * Shared by the slop detector's import scan (#399) and the built-in `any`
 * and TODO checks (#400). Every view keeps the original columns: blanked
 * characters become spaces.
 */

/** Lexer state carried from one line to the next. */
type LexState = "code" | "block" | "template";

export interface LexedLine {
	/** The line with comments blanked to spaces. */
	readonly code: string;
	/** `code` with string, template and regex contents blanked too; delimiters stay. */
	readonly masked: string;
	/** Only the comment text of the line; code and literals blanked. */
	readonly comments: string;
	/** State the next line starts in. */
	readonly state: LexState;
}

/** Keywords after which a `/` starts a regex literal, not a division. */
const REGEX_AFTER_WORD =
	/(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

/**
 * Whether a `/` that follows `before` (the line's code so far) opens a
 * regex literal: at line start, after an operator or opening bracket, after
 * `=>`, or after a keyword such as `return`. After an operand it divides.
 */
function slashStartsRegex(before: string): boolean {
	const prev = before.trimEnd();
	if (prev === "") return true;
	if (prev.endsWith("=>")) return true;
	if ("(,=:[!&|?{};".includes(prev[prev.length - 1] ?? "")) return true;
	return REGEX_AFTER_WORD.test(prev);
}

/**
 * The index just past the closing `/` of a regex literal whose opening `/`
 * is at `start`, or -1 when the line ends first (then it is a division).
 */
function regexLiteralEnd(line: string, start: number): number {
	let inClass = false;
	for (let i = start + 1; i < line.length; i++) {
		const ch = line[i];
		if (ch === "\\") i++;
		else if (ch === "[") inClass = true;
		else if (ch === "]") inClass = false;
		else if (ch === "/" && !inClass) return i + 1;
	}
	return -1;
}

/**
 * Lex one line starting in `start` state. Block comments and template
 * literals carry across lines; `'`/`"` strings and regex literals end at the
 * line break. Regex literals are skipped whole so a quote, backtick or `/*`
 * inside one cannot flip the lexer into another state. Backticks nested in
 * `${…}` are not modelled; they are rare and balance out on a line.
 *
 * A `'`/`"` string cannot span a line break, so a quote left open at the end
 * of the line (JSX text such as `<p>Don't</p>`, or a regex read as a
 * division) did not open a string. The line is lexed again with that quote
 * in `plainQuotes` treated as code, so the text after it is not masked.
 */
function lexLine(
	line: string,
	start: LexState,
	plainQuotes: ReadonlySet<number> = new Set(),
): LexedLine {
	let code = "";
	let masked = "";
	let comments = "";
	let state: LexState | "'" | '"' = start;
	let quoteAt = -1;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i] ?? "";
		const next = line[i + 1] ?? "";
		if (state === "block") {
			if (ch === "*" && next === "/") {
				state = "code";
				i++;
				code += "  ";
				masked += "  ";
				comments += "*/";
			} else {
				code += " ";
				masked += " ";
				comments += ch;
			}
			continue;
		}
		if (state === "code") {
			if (ch === "/" && next === "/") {
				comments += line.slice(i);
				break;
			}
			if (ch === "/" && next === "*") {
				state = "block";
				i++;
				code += "  ";
				masked += "  ";
				comments += "/*";
				continue;
			}
			if (ch === "/" && slashStartsRegex(code)) {
				const end = regexLiteralEnd(line, i);
				if (end !== -1) {
					const body = line.slice(i, end);
					code += body;
					masked += `/${" ".repeat(body.length - 2)}/`;
					comments += " ".repeat(body.length);
					i = end - 1;
					continue;
				}
			}
			if (ch === "`") state = "template";
			else if ((ch === "'" || ch === '"') && !plainQuotes.has(i)) {
				state = ch;
				quoteAt = i;
			}
			code += ch;
			masked += ch;
			comments += " ";
			continue;
		}
		// Inside a string or template literal
		const close = state === "template" ? "`" : state;
		if (ch === "\\" && next) {
			i++;
			code += ch + next;
			masked += "  ";
			comments += "  ";
		} else if (ch === close) {
			state = "code";
			code += ch;
			masked += ch;
			comments += " ";
		} else {
			code += ch;
			masked += " ";
			comments += " ";
		}
	}
	if ((state === "'" || state === '"') && !line.endsWith("\\")) {
		return lexLine(line, start, new Set([...plainQuotes, quoteAt]));
	}
	const carried: LexState =
		state === "block" || state === "template" ? state : "code";
	return { code, masked, comments, state: carried };
}

/** Lex every line of `content`, threading the carried state through. */
export function lexLines(content: string): readonly LexedLine[] {
	const lexed: LexedLine[] = [];
	let state: LexState = "code";
	for (const line of content.split("\n")) {
		const result = lexLine(line, state);
		lexed.push(result);
		state = result.state;
	}
	return lexed;
}
