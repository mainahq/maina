/**
 * The parity self-check at load (#575): step 5 of maina-model's
 * `docs/handoff/system1-artifact.md` §3, with the levels and tolerances of
 * `docs/handoff/parity.md` (ADR 0018).
 *
 * After a release verifies, the loader runs the first fixture of its
 * `parity-fixtures.json` through its own path and compares:
 *
 * - level 2: token ids and segment ids per window, exactly, and `truncated`;
 * - level 3: the length bucket, exactly;
 * - level 4: raw logits (each presented option, the escalate head, each
 *   action class, each score head) within 1e-2, the engine tolerance, with
 *   the fixture's own windows fed to the graph;
 * - level 5: calibrated probabilities within 5e-3, in the presented order.
 *
 * The fixtures must be the release's own: the verified parity file, naming
 * the release's model, version, tokenizer and calibration and encoding 1.
 * The tolerances are this loader's, never read from the file.
 *
 * The engine (onnxruntime-node, or the WASM fallback) arrives with #338; it
 * reaches this check as a port. A failure here disables `system1` for the
 * session, with the message as the notice (system1-artifact.md §8).
 */

import { createHash } from "node:crypto";
import type { Result } from "@mainahq/core";
import type { VerifiedModelRelease } from "./verify";

type Window = Readonly<{
	input_ids: readonly number[];
	segment_ids: readonly number[];
}>;

type ObservedQuestion =
	| Readonly<{
			kind: "choice" | "bool";
			/** Raw logit per option key, presented order. */
			logits: Readonly<Record<string, number>>;
			/** softmax(z / T) per option key, presented order. */
			calibrated: Readonly<Record<string, number>>;
	  }>
	| Readonly<{ kind: "score"; logit: number }>;

/** What the loader's own path produced for the fixture's request. */
export type ParityObservation = Readonly<{
	/** Level 2: the loader's encoding of the request. */
	encoding: Readonly<{ windows: readonly Window[]; truncated: boolean }>;
	/** Level 3: the loader's length bucket. */
	bucket: string;
	/** Levels 4 and 5, by question id. */
	questions: Readonly<Record<string, ObservedQuestion>>;
	escalateLogit: number | null;
	/** Action-class logits by class. */
	classLogits: Readonly<Record<string, number>>;
}>;

/**
 * Runs the loader's path on one fixture: encodes `request` (level 2) and
 * runs the graph on the fixture's own `windows` and `truncated` (level 4).
 */
export type ParityEngine = (
	input: Readonly<{
		request: unknown;
		windows: readonly Window[];
		truncated: boolean;
	}>,
) => Promise<ParityObservation>;

type ExpectedQuestion =
	| Readonly<{
			kind: "choice" | "bool";
			logits: readonly (readonly [string, number])[];
			calibrated: readonly (readonly [string, number])[];
	  }>
	| Readonly<{ kind: "score"; logit: number }>;

type Fixture = Readonly<{
	name: string;
	request: Readonly<Record<string, unknown>>;
	windows: readonly Window[];
	truncated: boolean;
	bucket: string;
	questions: readonly (readonly [string, ExpectedQuestion])[];
	escalateLogit: number | null;
	classLogits: readonly (readonly [string, number])[];
}>;

type ParityRefusal = Readonly<{
	kind: "fixtures_invalid" | "engine_failed" | "mismatch";
	problems: readonly string[];
	/** One line for the runtime's notice. */
	message: string;
}>;

type ParityPass = Readonly<{ fixture: string }>;

const SCHEMA = "maina-model/parity-fixtures@1";
const ENCODING_VERSION = 1;
/** parity.md level 4: the same int8 graph on another ISA or engine. */
const LOGIT_ABS = 1e-2;
/** parity.md level 5. */
const PROBABILITY_ABS = 5e-3;
/** Float slack so that a difference of exactly the tolerance passes. */
const EPSILON = 1e-9;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const isNumber = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);

const isIds = (v: unknown): v is readonly number[] =>
	Array.isArray(v) && v.every((n) => Number.isInteger(n));

const within = (observed: unknown, expected: number, tolerance: number) =>
	isNumber(observed) && Math.abs(observed - expected) <= tolerance + EPSILON;

/** The entries of `v`, if it is an object of finite numbers. */
function numberEntries(
	v: unknown,
): readonly (readonly [string, number])[] | undefined {
	if (!isRecord(v)) return undefined;
	const entries = Object.entries(v);
	return entries.every(([, n]) => isNumber(n))
		? (entries as [string, number][])
		: undefined;
}

function parseQuestion(v: unknown): ExpectedQuestion | undefined {
	if (!isRecord(v)) return undefined;
	if (v.kind === "score") {
		return isNumber(v.logit) ? { kind: "score", logit: v.logit } : undefined;
	}
	if (v.kind !== "choice" && v.kind !== "bool") return undefined;
	const logits = numberEntries(v.logits);
	const calibrated = numberEntries(v.calibrated);
	return logits && calibrated && logits.length > 0
		? { kind: v.kind, logits, calibrated }
		: undefined;
}

function parseWindow(v: unknown): Window | undefined {
	return isRecord(v) &&
		isIds(v.input_ids) &&
		isIds(v.segment_ids) &&
		v.input_ids.length === v.segment_ids.length
		? { input_ids: v.input_ids, segment_ids: v.segment_ids }
		: undefined;
}

/** The first fixture, if it has every field levels 2–5 compare. */
function parseFixture(v: unknown): Fixture | undefined {
	if (!isRecord(v) || typeof v.name !== "string" || !isRecord(v.request)) {
		return undefined;
	}
	const { encoding, bucket, questions, escalate, classes } = v;
	if (!isRecord(encoding) || typeof encoding.truncated !== "boolean") {
		return undefined;
	}
	if (!Array.isArray(encoding.windows) || encoding.windows.length === 0) {
		return undefined;
	}
	const windows = encoding.windows.map(parseWindow);
	if (!windows.every((w) => w !== undefined)) return undefined;
	if (typeof bucket !== "string" || !isRecord(questions)) return undefined;
	const parsed = Object.entries(questions).map(
		([id, q]) => [id, parseQuestion(q)] as const,
	);
	if (parsed.length === 0 || !parsed.every(([, q]) => q !== undefined)) {
		return undefined;
	}
	const escalateLogit =
		escalate === null ? null : isRecord(escalate) ? escalate.logit : undefined;
	if (escalateLogit !== null && !isNumber(escalateLogit)) return undefined;
	const classLogits =
		classes === undefined
			? []
			: isRecord(classes)
				? Object.entries(classes).map(
						([c, x]) => [c, isRecord(x) ? x.logit : undefined] as const,
					)
				: undefined;
	if (classLogits === undefined || !classLogits.every(([, x]) => isNumber(x))) {
		return undefined;
	}
	return {
		name: v.name,
		request: v.request,
		windows,
		truncated: encoding.truncated,
		bucket,
		questions: parsed as (readonly [string, ExpectedQuestion])[],
		escalateLogit,
		classLogits: classLogits as (readonly [string, number])[],
	};
}

const shaOf = (release: VerifiedModelRelease, kind: string) =>
	release.files.find((f) => f.kind === kind)?.sha256;

/** The first fixture, if `bytes` are this release's own fixtures. */
function readFixtures(
	release: VerifiedModelRelease,
	bytes: Uint8Array,
): Result<Fixture, readonly string[]> {
	const sha = createHash("sha256").update(bytes).digest("hex");
	if (sha !== shaOf(release, "parity")) {
		return { ok: false, error: ["not the verified parity-fixtures.json"] };
	}
	let file: unknown;
	try {
		file = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return { ok: false, error: ["not JSON"] };
	}
	if (!isRecord(file)) return { ok: false, error: ["not an object"] };
	const { manifest } = release;
	const model = isRecord(file.model) ? file.model : {};
	const checks: readonly (readonly [boolean, string])[] = [
		[
			file.schema === SCHEMA,
			`schema ${String(file.schema)}, expected ${SCHEMA}`,
		],
		[model.sha256 === shaOf(release, "model"), "names another model"],
		[
			model.version === manifest.version,
			`model version ${String(model.version)}, expected ${manifest.version}`,
		],
		[
			file.calibration_sha256 === manifest.calibration.sha256,
			"names another calibration",
		],
		[
			file.tokenizer_sha256 === shaOf(release, "tokenizer"),
			"names another tokenizer",
		],
		[
			file.encoding_version === ENCODING_VERSION,
			`encoding version ${String(file.encoding_version)}, expected ${ENCODING_VERSION}`,
		],
	];
	const problems = checks.flatMap(([ok, problem]) => (ok ? [] : [problem]));
	const fixtures = Array.isArray(file.fixtures) ? file.fixtures : [];
	const first = parseFixture(fixtures[0]);
	if (first === undefined) {
		problems.push(
			fixtures.length === 0 ? "no fixtures" : "the first fixture is malformed",
		);
	}
	return problems.length === 0 && first !== undefined
		? { ok: true, value: first }
		: { ok: false, error: problems };
}

const sameIds = (a: readonly number[], b: readonly number[]) =>
	a.length === b.length && a.every((n, i) => n === b[i]);

/** Level 2. */
function encodingProblems(
	fixture: Fixture,
	observed: ParityObservation["encoding"],
): readonly string[] {
	const problems: string[] = [];
	if (observed.truncated !== fixture.truncated) {
		problems.push(
			`truncated ${observed.truncated}, expected ${fixture.truncated}`,
		);
	}
	if (observed.windows.length !== fixture.windows.length) {
		return [
			...problems,
			`${observed.windows.length} windows, expected ${fixture.windows.length}`,
		];
	}
	fixture.windows.forEach((expected, i) => {
		const window = observed.windows[i];
		if (!window || !sameIds(window.input_ids, expected.input_ids)) {
			problems.push(`window ${i}: input_ids differ`);
		}
		if (!window || !sameIds(window.segment_ids, expected.segment_ids)) {
			problems.push(`window ${i}: segment_ids differ`);
		}
	});
	return problems;
}

/** Each expected value of `expected` found in `observed` within `tolerance`. */
function valueProblems(
	label: string,
	expected: readonly (readonly [string, number])[],
	observed: Readonly<Record<string, number>> | undefined,
	tolerance: number,
): readonly string[] {
	return expected.flatMap(([key, value]) => {
		const got = observed?.[key];
		return within(got, value, tolerance)
			? []
			: [`${label} ${key}: ${String(got)}, expected ${value}`];
	});
}

/** Levels 4 and 5 for one question. */
function questionProblems(
	id: string,
	expected: ExpectedQuestion,
	observed: ObservedQuestion | undefined,
): readonly string[] {
	const at = `question ${id}`;
	if (observed === undefined) return [`${at}: missing`];
	if (observed.kind !== expected.kind) {
		return [`${at}: kind ${observed.kind}, expected ${expected.kind}`];
	}
	if (expected.kind === "score" || observed.kind === "score") {
		const got = observed.kind === "score" ? observed.logit : undefined;
		const want = expected.kind === "score" ? expected.logit : Number.NaN;
		return within(got, want, LOGIT_ABS)
			? []
			: [`${at}: score logit ${String(got)}, expected ${want}`];
	}
	const order = Object.keys(observed.calibrated ?? {});
	const presented = expected.calibrated.map(([k]) => k);
	const orderProblem =
		order.join("\0") === presented.join("\0")
			? []
			: [
					`${at}: calibrated order ${order.join(",")}, presented ${presented.join(",")}`,
				];
	return [
		...valueProblems(
			`${at}: logit`,
			expected.logits,
			observed.logits,
			LOGIT_ABS,
		),
		...valueProblems(
			`${at}: calibrated`,
			expected.calibrated,
			observed.calibrated,
			PROBABILITY_ABS,
		),
		...orderProblem,
	];
}

/** Every level 2–5 difference between the fixture and the observation. */
function parityProblems(
	fixture: Fixture,
	observed: ParityObservation,
): readonly string[] {
	const bucketProblem =
		observed.bucket === fixture.bucket
			? []
			: [`bucket ${observed.bucket}, expected ${fixture.bucket}`];
	const escalateProblem =
		fixture.escalateLogit === null ||
		within(observed.escalateLogit, fixture.escalateLogit, LOGIT_ABS)
			? []
			: [
					`escalate logit ${String(observed.escalateLogit)}, expected ${fixture.escalateLogit}`,
				];
	return [
		...encodingProblems(fixture, observed.encoding),
		...bucketProblem,
		...fixture.questions.flatMap(([id, q]) =>
			questionProblems(id, q, observed.questions[id]),
		),
		...escalateProblem,
		...valueProblems(
			"class logit",
			fixture.classLogits,
			observed.classLogits,
			LOGIT_ABS,
		),
	];
}

const errorText = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

/**
 * Runs the first parity fixture of the verified `release` through `engine`
 * and compares it at levels 2–5. `fixtures` are the bytes of the release's
 * `parity-fixtures.json`. Never rejects.
 */
export async function paritySelfCheck(
	input: Readonly<{
		release: VerifiedModelRelease;
		fixtures: Uint8Array;
		engine: ParityEngine;
	}>,
): Promise<Result<ParityPass, ParityRefusal>> {
	const version = input.release.manifest.version;
	const refuse = (
		kind: ParityRefusal["kind"],
		at: string,
		problems: readonly string[],
	): Result<never, ParityRefusal> => ({
		ok: false,
		error: {
			kind,
			problems,
			message: `model ${version} failed the parity self-check (${at}: ${problems.join("; ")})`,
		},
	});
	const read = readFixtures(input.release, input.fixtures);
	if (!read.ok) {
		return refuse("fixtures_invalid", "parity-fixtures.json", read.error);
	}
	const fixture = read.value;
	let problems: readonly string[];
	try {
		const observed = await input.engine({
			request: fixture.request,
			windows: fixture.windows,
			truncated: fixture.truncated,
		});
		problems = parityProblems(fixture, observed);
	} catch (e) {
		return refuse("engine_failed", fixture.name, [`engine: ${errorText(e)}`]);
	}
	return problems.length === 0
		? { ok: true, value: { fixture: fixture.name } }
		: refuse("mismatch", fixture.name, problems);
}
