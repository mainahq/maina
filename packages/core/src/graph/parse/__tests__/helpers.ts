import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFile } from "../index";
import type {
	Lang,
	ParsedCall,
	ParsedFile,
	ParsedRef,
	ParsedSymbol,
	ParsedTest,
} from "../types";

const FIXTURES = join(import.meta.dir, "fixtures");

/** Fixture source; files carry a `.txt` suffix so no tool treats them as project code. */
export function fixture(name: string): string {
	return readFileSync(join(FIXTURES, `${name}.txt`), "utf8");
}

/** Parse a fixture as if it lived at `name` (its real extension picks the grammar). */
export async function parseFixture(name: string): Promise<ParsedFile> {
	return parseSource(name, fixture(name));
}

export async function parseSource(
	path: string,
	content: string,
	lang?: Lang,
): Promise<ParsedFile> {
	const result = await parseFile(path, content, lang);
	if (!result.ok) {
		expect(result.error).toBeUndefined();
		throw new Error("unreachable");
	}
	return result.value;
}

/** `kind qualifiedName exported` — compact and order-preserving. */
export const symbolRows = (file: ParsedFile): readonly string[] =>
	file.symbols.map(
		(s: ParsedSymbol) =>
			`${s.kind} ${s.qualifiedName}${s.exported ? " exported" : ""}`,
	);

/** `scope | callee | kind` with `-` for top level. */
export const callRows = (file: ParsedFile): readonly string[] =>
	file.calls.map(
		(c: ParsedCall) => `${c.scope ?? "-"} | ${c.callee} | ${c.kind}`,
	);

/** `kind scope name` with `-` for top level. */
export const refRows = (file: ParsedFile): readonly string[] =>
	file.refs.map((r: ParsedRef) => `${r.kind} ${r.scope ?? "-"} ${r.name}`);

/** `kind qualifiedName`. */
export const testRows = (file: ParsedFile): readonly string[] =>
	file.tests.map((t: ParsedTest) => `${t.kind} ${t.qualifiedName}`);
