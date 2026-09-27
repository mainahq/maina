/**
 * The System 1 input contract, encoding version 1 (#582, for #338). The
 * model's reference is mainahq/maina-model `docs/handoff/encoding.md`
 * (`model/encoding.py`); this module is its TypeScript side, up to the
 * tokenizer:
 *
 *   2. canonicalise — `canonicaliseState`: the workspace root becomes
 *      `⟨root⟩`, home directories `~`, the top-level `sessionId` is dropped
 *      and set-valued trusted fields (`classes`) are sorted;
 *   3. serialise    — `jsCanonicalJson`: compact JSON with keys sorted by UTF-16
 *      code units at every depth, hand-written because `JSON.stringify`
 *      always puts integer-like keys first in numeric order (`0,1,2,…,10,11`
 *      where the model writes `0,1,10,11,2,…`);
 *   4. scrub        — `scrub`: chat-token openers and the artifact's forbidden
 *      strings are broken with a space, until a pass changes nothing.
 *
 * Question ids and options are never encoded. They are measured only by the
 * length bucket (`lengthBucket` in `evidence.ts`), at their base id: the
 * gate's second, reversed call suffixes its id with `REVERSED_SUFFIX`.
 *
 * `pythonCanonicalJson` is the other canonical form the model uses: Python's
 * `json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`,
 * which `contracts/buckets.py` measures.
 *
 * Any change to what these produce changes what the model sees: it needs a
 * coordinated `ENCODING_VERSION` bump here and in maina-model. The parity
 * fixtures in `__fixtures__/encoding-parity.json` hold the reference's own
 * output.
 */

import type { Result } from "../db/index";
import type { DecisionState } from "./types";

/** The encoding this module implements (encoding.md, `config.json` `encoding.version`). */
export const ENCODING_VERSION = 1;

/** Appended to the gate's question id on its second, reversed call. */
export const REVERSED_SUFFIX = ":reversed";

export const ROOT_PLACEHOLDER = "⟨root⟩";
export const HOME_PLACEHOLDER = "~";

/** The untrusted field holding the workspace root. */
export const ROOT_FIELD = "root";

/** Trusted fields that are sets: sorted, so presentation order never counts. */
export const SET_VALUED_TRUSTED: readonly string[] = ["classes"];

/** Untrusted top-level fields the model never sees. */
export const DROPPED_UNTRUSTED: readonly string[] = ["sessionId"];

export type EncodingError = Readonly<{
	kind: "scrub_not_converged";
	message: string;
}>;

export type CanonicalTexts = Readonly<{ trusted: string; untrusted: string }>;

/** `id` without one trailing `REVERSED_SUFFIX`. */
export function baseQuestionId(id: string): string {
	return id.endsWith(REVERSED_SUFFIX)
		? id.slice(0, -REVERSED_SUFFIX.length)
		: id;
}

// ── Serialisers ─────────────────────────────────────────────────────────────

type Style = Readonly<{
	compareKeys: (a: string, b: string) => number;
	/** A finite number. */
	number: (n: number) => string;
}>;

/** UTF-16 code unit order: JavaScript's default string order. */
function byCodeUnit(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** Code point order: Python's string order. */
function byCodePoint(a: string, b: string): number {
	const x = [...a];
	const y = [...b];
	for (let i = 0; i < Math.min(x.length, y.length); i++) {
		const d = (x[i]?.codePointAt(0) ?? 0) - (y[i]?.codePointAt(0) ?? 0);
		if (d !== 0) return d;
	}
	return x.length - y.length;
}

/**
 * `value` as compact JSON in `style`, or `undefined` where JSON has no value
 * (`undefined`, functions, symbols, bigints): such object members are
 * dropped and such array items written as `null`, as `JSON.stringify` does.
 * Strings escape as `JSON.stringify` escapes them: `\"`, `\\`, the short
 * escapes, other code units below U+0020 and lone surrogates as lowercase
 * `\u` escapes, everything else literal.
 */
function serialise(value: unknown, style: Style): string | undefined {
	if (value === null) return "null";
	switch (typeof value) {
		case "boolean":
			return value ? "true" : "false";
		case "number":
			return Number.isFinite(value) ? style.number(value) : "null";
		case "string":
			return JSON.stringify(value);
		case "object": {
			if (Array.isArray(value)) {
				const items = value.map((v: unknown) => serialise(v, style) ?? "null");
				return `[${items.join(",")}]`;
			}
			const record = value as Readonly<Record<string, unknown>>;
			const members = Object.keys(record)
				.sort(style.compareKeys)
				.flatMap((key) => {
					const v = serialise(record[key], style);
					return v === undefined ? [] : [`${JSON.stringify(key)}:${v}`];
				});
			return `{${members.join(",")}}`;
		}
		default:
			return undefined;
	}
}

const JS_STYLE: Style = { compareKeys: byCodeUnit, number: String };

/**
 * encoding.md step 3: byte-identical to `JSON.stringify` over recursively
 * sorted keys, except that integer-like keys sort as strings too. Numbers
 * print as ECMAScript `Number::toString`; non-finite ones as `null`.
 */
export function jsCanonicalJson(value: unknown): string {
	return serialise(value, JS_STYLE) ?? "null";
}

/**
 * Python's `repr` of a float, from its shortest round-trip digits: plain
 * notation for decimal exponents -4..15, else `d.ddde±XX`.
 */
function pythonFloat(x: number): string {
	const [mantissa = "0", exponent = "0"] = x.toExponential().split("e");
	const e = Number(exponent);
	const sign = mantissa.startsWith("-") ? "-" : "";
	const digits = mantissa.replace("-", "").replace(".", "");
	if (e < -4 || e >= 16) {
		const m = digits.length === 1 ? digits : `${digits[0]}.${digits.slice(1)}`;
		const magnitude = String(Math.abs(e)).padStart(2, "0");
		return `${sign}${m}e${e < 0 ? "-" : "+"}${magnitude}`;
	}
	if (e < 0) return `${sign}0.${"0".repeat(-e - 1)}${digits}`;
	const whole = digits.slice(0, e + 1).padEnd(e + 1, "0");
	const fraction = digits.slice(e + 1);
	return `${sign}${whole}.${fraction === "" ? "0" : fraction}`;
}

/**
 * A number as Python prints it after reading JavaScript's JSON: what
 * `JSON.stringify` writes as digits only is a Python int; anything else
 * (a fraction, an exponent) is a Python float.
 */
function pythonNumber(n: number): string {
	const js = String(n);
	return /^-?\d+$/.test(js) ? js : pythonFloat(n);
}

const PYTHON_STYLE: Style = { compareKeys: byCodePoint, number: pythonNumber };

/**
 * `json.dumps(value, sort_keys=True, separators=(",", ":"),
 * ensure_ascii=False)` of `value` as the model reads it from JavaScript's
 * JSON: keys by code point, Python number formatting (`1e-07`, `1.5`,
 * `1e+22`), non-finite numbers as `null`. Lone surrogates, which Python
 * cannot encode, are escaped as in `jsCanonicalJson`.
 */
export function pythonCanonicalJson(value: unknown): string {
	return serialise(value, PYTHON_STYLE) ?? "null";
}

// ── Canonicalisation (encoding.md step 2) ───────────────────────────────────

/** Not after, and not before, a path character (ASCII word-ish or non-ASCII). */
const BEFORE = String.raw`(?<![A-Za-z0-9._~+@%\-])(?<![^\x00-\x7F])`;
const AFTER = String.raw`(?![A-Za-z0-9._~+@%\-])(?![^\x00-\x7F])`;
const NAME = String.raw`[A-Za-z0-9._\-]+`;

const HOME_PATTERN = new RegExp(
	`${BEFORE}(?:/Users/${NAME}|/home/${NAME}|/root|${String.raw`[A-Za-z]:\\Users\\`}${NAME})${AFTER}`,
	"g",
);

const WINDOWS_ROOT = /^[A-Za-z]:\\/;

/** `⟨` and `⟩` become `<` and `>`, so the root placeholder is unforgeable. */
function defang(s: string): string {
	return s.replaceAll("⟨", "<").replaceAll("⟩", ">");
}

/** The workspace-root matcher, or `undefined` for a root that is not a usable absolute path. */
function rootPattern(root: unknown): RegExp | undefined {
	if (typeof root !== "string") return undefined;
	const r = defang(root).replace(/[/\\]+$/, "");
	if (r.length < 2 || !(r.startsWith("/") || WINDOWS_ROOT.test(r))) {
		return undefined;
	}
	const literal = r.replace(/[.*+?^${}()|[\]\\/-]/g, String.raw`\$&`);
	return new RegExp(`${BEFORE}${literal}${AFTER}`, "g");
}

function normaliseString(s: string, root: RegExp | undefined): string {
	const defanged = defang(s);
	const rooted =
		root === undefined ? defanged : defanged.replace(root, ROOT_PLACEHOLDER);
	return rooted.replace(HOME_PATTERN, HOME_PLACEHOLDER);
}

/** Every string value, recursively, through `normalise`; keys untouched. */
function walk(value: unknown, normalise: (s: string) => string): unknown {
	if (typeof value === "string") return normalise(value);
	if (Array.isArray(value)) return value.map((v) => walk(v, normalise));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [k, walk(v, normalise)]),
		);
	}
	return value;
}

/**
 * The canonical copies of a decision state (encoding.md step 2): the
 * top-level session id dropped, the workspace root (`untrusted.root`) and
 * home directories replaced by placeholders in every string value of both
 * segments, and set-valued trusted fields sorted by UTF-16 code units.
 */
export function canonicaliseState(state: DecisionState): DecisionState {
	const root = rootPattern(state.untrusted[ROOT_FIELD]);
	const normalise = (s: string) => normaliseString(s, root);
	const trusted = walk(state.trusted, normalise) as Record<string, unknown>;
	for (const key of SET_VALUED_TRUSTED) {
		const v = trusted[key];
		if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
			trusted[key] = [...v].sort(byCodeUnit);
		}
	}
	const kept = Object.fromEntries(
		Object.entries(state.untrusted).filter(
			([k]) => !DROPPED_UNTRUSTED.includes(k),
		),
	);
	const untrusted = walk(kept, normalise) as Record<string, unknown>;
	return { trusted, untrusted };
}

// ── Scrub (encoding.md step 4) ──────────────────────────────────────────────

const CHAT_OPEN = "<|";
const CHAT_OPEN_BROKEN = "< |";
const MAX_SCRUB_PASSES = 16;

/** `f` with a space after its first character. */
function broken(f: string): string {
	const [first = "", ...rest] = [...f];
	return `${first} ${rest.join("")}`;
}

/**
 * `text` with every `<|` and every `forbidden` string broken by a space
 * after its first character, longest strings first, repeated until a pass
 * changes nothing (at most 16 passes).
 */
export function scrub(
	text: string,
	forbidden: readonly string[],
): Result<string, EncodingError> {
	const order = [...new Set(forbidden)]
		.filter((f) => f.length > 0)
		.sort((a, b) => [...b].length - [...a].length || byCodeUnit(a, b));
	let current = text;
	for (let pass = 0; pass < MAX_SCRUB_PASSES; pass++) {
		const before = current;
		current = current.replaceAll(CHAT_OPEN, () => CHAT_OPEN_BROKEN);
		for (const f of order) {
			const replacement = broken(f);
			current = current.replaceAll(f, () => replacement);
		}
		if (current === before) return { ok: true, value: current };
	}
	return {
		ok: false,
		error: {
			kind: "scrub_not_converged",
			message: `scrub did not reach a fixed point in ${MAX_SCRUB_PASSES} passes`,
		},
	};
}

/**
 * The trusted and untrusted texts the model tokenises (encoding.md steps
 * 2 to 4). `forbidden` is the artifact's `encoding.forbidden_strings`.
 */
export function canonicalTexts(
	state: DecisionState,
	forbidden: readonly string[],
): Result<CanonicalTexts, EncodingError> {
	const canonical = canonicaliseState(state);
	const trusted = scrub(jsCanonicalJson(canonical.trusted), forbidden);
	if (!trusted.ok) return trusted;
	const untrusted = scrub(jsCanonicalJson(canonical.untrusted), forbidden);
	if (!untrusted.ok) return untrusted;
	return {
		ok: true,
		value: { trusted: trusted.value, untrusted: untrusted.value },
	};
}
