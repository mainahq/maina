/**
 * Reads the command lines that run a program on another machine, or through
 * another program on this one (#622), the way each tool parses its own
 * options: `rsync -e`/`--rsync-path`, `scp -S`/`-o`, `sftp -D`/`-s`.
 *
 * As with ssh (#614), what runs remotely is never classified, only marked:
 * its paths and services live where the gate cannot see. What runs here is
 * handed back as shell text for the caller to classify.
 */

import { parseSsh } from "./ssh";

/** A word of the command line; `null` when the gate cannot resolve it. */
type Word = string | null;

/** A word as resolved (`text`, `null` if unresolved) and as written (`raw`). */
type Token = Readonly<{ text: string | null; raw: string }>;

export type Indirection = Readonly<{
	/** A command the gate cannot see runs on another host. */
	remote: boolean;
	/** Shell text run on this machine; `null` for one the gate cannot read. */
	local: readonly Word[];
	/** Indexes of the words read as option values, which are not operands. */
	values: ReadonlySet<number>;
}>;

type Found = { remote: boolean; local: Word[]; values: Set<number> };

/**
 * An option word, named even when its value is unresolved: the source text
 * of `--rsync-path=$RP` still names the option, and its value is unknown.
 * For an unresolved word, `name` is only its literal start (`-e` of
 * `-e$RSH`), so the letters of a variable name are never read as options.
 */
type OptionWord = Readonly<{ name: string; known: boolean }>;

function optionWord(token: Token): OptionWord | null {
	const name = token.text ?? /^["']?(-[^$`"'\\]*)/.exec(token.raw)?.[1] ?? "";
	if (!name.startsWith("-") || name.length < 2 || name === "--") return null;
	return { name, known: token.text !== null };
}

/** rsync short options whose value is the rest of the cluster or the next word. */
const RSYNC_SHORT_VALUE: ReadonlySet<string> = new Set("eBfTM@");

/**
 * `rsync -e CMD` / `--rsh=CMD` runs CMD here as the remote shell;
 * `--rsync-path=CMD` runs CMD on the remote host. A remote rsync binary
 * named by path (`/usr/local/bin/rsync`) is the only clear value: anything
 * else (`sudo rsync`, `rm -rf /; rsync`) is a remote command.
 */
export function parseRsync(tokens: readonly Token[]): Indirection {
	const found: Found = { remote: false, local: [], values: new Set() };
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i]?.text === "--") break;
		const word = optionWord(tokens[i] as Token);
		if (word === null) continue;
		i += word.name.startsWith("--")
			? readRsyncLong(word, tokens, i, found)
			: readCluster(word, RSYNC_SHORT_VALUE, tokens, i, found, (flag, v) => {
					if (flag === "e") found.local.push(v);
				});
	}
	return found;
}

/** Reads one `--name=value` or `--name value`; returns 1 when it took the next word. */
function readRsyncLong(
	word: OptionWord,
	tokens: readonly Token[],
	i: number,
	found: Found,
): number {
	const eq = word.name.indexOf("=");
	const name = eq < 0 ? word.name : word.name.slice(0, eq);
	if (name !== "--rsh" && name !== "--rsync-path") return 0;
	// An unresolved word carries its own (unknown) value.
	const separate = eq < 0 && word.known;
	const glued = word.known ? word.name.slice(eq + 1) : null;
	const value = separate ? valueAt(tokens, i + 1, found) : glued;
	if (name === "--rsh") found.local.push(value);
	else if (!isRsyncBinary(value)) found.remote = true;
	return separate ? 1 : 0;
}

const isRsyncBinary = (value: Word): boolean =>
	value !== null && /^(?:\S*\/)?rsync$/.test(value.trim());

/** scp options that take a value, glued or as the next word. */
const SCP_VALUE: ReadonlySet<string> = new Set("cDFiJloPSX");
/** sftp options that take a value; `-B`, `-R`, `-s` differ from scp's. */
const SFTP_VALUE: ReadonlySet<string> = new Set("BbcDFiJloPRSsX");

/**
 * `scp`/`sftp`: `-S program` is run here in place of ssh, `-D command`
 * connects to a local server program, and `-o ProxyCommand=…` (read as ssh
 * reads it) runs here too. `sftp -s /path/server` starts a program on the
 * remote host instead of a named subsystem.
 */
export function parseScp(tokens: readonly Token[], sftp: boolean): Indirection {
	const withValue = sftp ? SFTP_VALUE : SCP_VALUE;
	const found: Found = { remote: false, local: [], values: new Set() };
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i]?.text === "--") break;
		const word = optionWord(tokens[i] as Token);
		if (word === null || word.name.startsWith("--")) continue;
		i += readCluster(word, withValue, tokens, i, found, (flag, value) =>
			readScpOption(flag, value, sftp, found),
		);
	}
	return found;
}

function readScpOption(
	flag: string,
	value: Word,
	sftp: boolean,
	found: Found,
): void {
	if (flag === "S") found.local.push(value === null ? null : quoteWord(value));
	else if (flag === "D") found.local.push(value);
	else if (flag === "o")
		found.local.push(...parseSsh(["-o", value, "h"]).local);
	else if (flag === "s" && sftp && !/^[\w.-]+$/.test(value ?? "/"))
		found.remote = true;
}

/**
 * Reads one cluster of short options (`-avz`, `-e ssh`, `-oKey=v`): the
 * first one that takes a value gets the rest of the cluster, or the next
 * word, and ends it. Returns 1 when it took the next word.
 */
function readCluster(
	word: OptionWord,
	withValue: ReadonlySet<string>,
	tokens: readonly Token[],
	i: number,
	found: Found,
	onValue: (flag: string, value: Word) => void,
): number {
	for (let j = 1; j < word.name.length; j++) {
		const flag = word.name[j] as string;
		if (!withValue.has(flag)) continue;
		const rest = word.name.slice(j + 1);
		if (!word.known) {
			// `-e$RSH`: the value is the unresolved rest of this word.
			onValue(flag, null);
			return 0;
		}
		if (rest === "") {
			onValue(flag, valueAt(tokens, i + 1, found));
			return 1;
		}
		onValue(flag, rest);
		return 0;
	}
	return 0;
}

/** The word at `i` as an option's value, recorded as not an operand. */
function valueAt(tokens: readonly Token[], i: number, found: Found): Word {
	if (i >= tokens.length) return null;
	found.values.add(i);
	return tokens[i]?.text ?? null;
}

/** One word as shell text that parses back to the same word. */
export const quoteWord = (word: string): string =>
	`'${word.replace(/'/g, "'\\''")}'`;
