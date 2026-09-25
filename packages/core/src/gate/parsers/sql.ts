/**
 * SQL statement classification for the gate (`db.destructive`).
 *
 * A tokenizer, not a full SQL grammar: the gate only needs each statement's
 * verb and whether it is bounded. Strings, quoted identifiers, dollar-quoted
 * bodies and comments are tokens of their own, so `SELECT 'DROP TABLE x'`
 * and `-- DROP TABLE x` never count.
 *
 * Destructive: `DROP`, `TRUNCATE`, `ALTER … DROP`, and `DELETE` / `UPDATE`
 * without a `WHERE`, or with a tautology such as `WHERE true` or `WHERE 1=1`.
 */

type SqlStatement = Readonly<{ verb: string; destructive: boolean }>;

type Token = Readonly<{ kind: "word" | "punct" | "literal"; text: string }>;

function tokenize(sql: string): readonly Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const n = sql.length;
	while (i < n) {
		const c = sql[i] as string;
		const next = sql[i + 1];
		if (/\s/.test(c)) {
			i++;
		} else if (c === "-" && next === "-") {
			const end = sql.indexOf("\n", i);
			i = end < 0 ? n : end + 1;
		} else if (c === "#") {
			// MySQL line comment.
			const end = sql.indexOf("\n", i);
			i = end < 0 ? n : end + 1;
		} else if (c === "/" && next === "*") {
			const end = sql.indexOf("*/", i + 2);
			i = end < 0 ? n : end + 2;
		} else if (c === "'" || c === '"' || c === "`") {
			// Strings and quoted identifiers; a doubled quote is an escape.
			let j = i + 1;
			while (j < n) {
				if (sql[j] === "\\" && c === "'") j += 2;
				else if (sql[j] === c && sql[j + 1] === c) j += 2;
				else if (sql[j] === c) break;
				else j++;
			}
			tokens.push({
				kind: c === "'" ? "literal" : "word",
				text: sql.slice(i + 1, Math.min(j, n)),
			});
			i = j + 1;
		} else if (c === "$") {
			// Dollar-quoted body: $$ … $$ or $tag$ … $tag$.
			const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
			if (tag) {
				const end = sql.indexOf(tag, i + tag.length);
				tokens.push({ kind: "literal", text: "" });
				i = end < 0 ? n : end + tag.length;
			} else {
				tokens.push({ kind: "punct", text: c });
				i++;
			}
		} else if (/[A-Za-z0-9_.]/.test(c)) {
			const m = /^[A-Za-z0-9_.]+/.exec(sql.slice(i))?.[0] ?? c;
			tokens.push({ kind: "word", text: m });
			i += m.length;
		} else {
			tokens.push({ kind: "punct", text: c });
			i++;
		}
	}
	return tokens;
}

function splitStatements(
	tokens: readonly Token[],
): readonly (readonly Token[])[] {
	const out: Token[][] = [[]];
	for (const t of tokens) {
		if (t.kind === "punct" && t.text === ";") out.push([]);
		else out[out.length - 1]?.push(t);
	}
	return out.filter((s) => s.length > 0);
}

const upper = (t: Token | undefined): string =>
	t?.kind === "word" ? t.text.toUpperCase() : "";

/** The first keyword after an optional `WITH …` prefix at parenthesis depth 0. */
function mainVerb(
	stmt: readonly Token[],
): Readonly<{ verb: string; at: number }> {
	if (upper(stmt[0]) !== "WITH") return { verb: upper(stmt[0]), at: 0 };
	let depth = 0;
	for (let i = 1; i < stmt.length; i++) {
		const t = stmt[i] as Token;
		if (t.kind === "punct" && t.text === "(") depth++;
		else if (t.kind === "punct" && t.text === ")") depth--;
		else if (depth === 0) {
			const w = upper(t);
			if (["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"].includes(w)) {
				return { verb: w, at: i };
			}
		}
	}
	return { verb: "WITH", at: 0 };
}

/** `WHERE` conditions that match every row, compared with whitespace removed. */
const TAUTOLOGIES: ReadonlySet<string> = new Set([
	"TRUE",
	"1",
	"1=1",
	"'1'='1'",
]);

/** Whether the statement has a `WHERE` that actually restricts rows. */
function isBounded(stmt: readonly Token[], from: number): boolean {
	let depth = 0;
	for (let i = from; i < stmt.length; i++) {
		const t = stmt[i] as Token;
		if (t.kind === "punct" && t.text === "(") depth++;
		else if (t.kind === "punct" && t.text === ")") depth--;
		else if (depth === 0 && upper(t) === "WHERE") {
			const cond = stmt
				.slice(i + 1)
				.map((r) => (r.kind === "literal" ? `'${r.text}'` : r.text))
				.join("")
				.toUpperCase();
			return cond.length > 0 && !TAUTOLOGIES.has(cond);
		}
	}
	return false;
}

function classify(stmt: readonly Token[]): SqlStatement {
	const { verb, at } = mainVerb(stmt);
	switch (verb) {
		case "DROP":
		case "TRUNCATE":
			return { verb, destructive: true };
		case "DELETE":
		case "UPDATE":
			return { verb, destructive: !isBounded(stmt, at + 1) };
		case "ALTER":
			return {
				verb,
				destructive: stmt.slice(at + 1).some((t) => upper(t) === "DROP"),
			};
		default:
			return { verb, destructive: false };
	}
}

/** Every statement in `sql`, in order, with its verb. */
export function analyzeSql(sql: string): readonly SqlStatement[] {
	return splitStatements(tokenize(sql)).map(classify);
}

export function isDestructiveSql(sql: string): boolean {
	return analyzeSql(sql).some((s) => s.destructive);
}
