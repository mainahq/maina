/**
 * The parity self-check at load (#575), system1-artifact.md §3 step 5 and
 * parity.md: the first fixture of the verified `parity-fixtures.json` runs
 * through the loader's own path and must match at levels 2–5 (token and
 * segment ids exactly, the bucket exactly, raw logits within 1e-2,
 * calibrated probabilities within 5e-3). The fixtures must belong to the
 * verified release: its model, tokenizer, calibration and version.
 *
 * The ONNX engine arrives with #338, so the engine here is a port; a fake
 * reproduces the fixture and each test perturbs one level.
 */

import { describe, expect, test } from "bun:test";
import {
	type ParityEngine,
	type ParityObservation,
	paritySelfCheck,
} from "../parity";
import { type VerifiedModelRelease, verifyModelRelease } from "../verify";
import {
	buildRelease,
	checkerFor,
	devKey,
	parityFixtures,
	pinOn,
	utf8,
} from "./fixtures/model-release";

const KEY = devKey();

type Json = Record<string, unknown>;

/** A verified release carrying `parity` as its signed fixtures. */
function verified(parity: Json = parityFixtures()): Readonly<{
	release: VerifiedModelRelease;
	fixtures: Uint8Array;
}> {
	const built = buildRelease(KEY.privatePem, { parity });
	const result = verifyModelRelease({
		pin: pinOn(built.manifestBytes),
		read: (f) => built.files.get(f),
		verifySignature: checkerFor(KEY.publicPem),
		target: "linux-x64",
	});
	if (!result.ok) {
		throw new Error(`fixture release did not verify: ${result.error.message}`);
	}
	const fixtures = built.files.get("parity-fixtures.json");
	if (fixtures === undefined) throw new Error("no parity fixtures");
	return { release: result.value, fixtures };
}

/** What a loader that reproduces the first fixture observes. */
const exact = (): ParityObservation => ({
	encoding: {
		windows: [
			{
				input_ids: [1, 7, 42, 43, 2, 99, 100, 2],
				segment_ids: [0, 0, 0, 0, 0, 1, 1, 1],
			},
		],
		truncated: false,
	},
	bucket: "le128",
	questions: {
		risk: {
			kind: "choice",
			logits: { allow: 1.93, ask: -0.41, deny: -2.2 },
			calibrated: { allow: 0.8, ask: 0.15, deny: 0.05 },
		},
	},
	escalateLogit: -2.1,
	classLogits: { "fs.read": 3.2, "fs.write": -1.4 },
});

type EngineCall = Parameters<ParityEngine>[0];

/** An engine returning `observation`, recording what it was asked. */
function engine(observation: ParityObservation = exact()) {
	const calls: EngineCall[] = [];
	const run: ParityEngine = async (input) => {
		calls.push(input);
		return observation;
	};
	return { calls, run };
}

async function check(
	observation: ParityObservation,
	parity: Json = parityFixtures(),
) {
	const { release, fixtures } = verified(parity);
	return paritySelfCheck({
		release,
		fixtures,
		engine: engine(observation).run,
	});
}

const problemsOf = (
	r: Awaited<ReturnType<typeof paritySelfCheck>>,
): readonly string[] => (r.ok ? [] : r.error.problems);

describe("paritySelfCheck: passing", () => {
	test("passes when the loader reproduces the first fixture", async () => {
		const result = await check(exact());
		expect(result).toEqual({
			ok: true,
			value: { fixture: "short:action.risk:5c4e4d19bb31" },
		});
	});

	test("runs only the first fixture, fed its own windows (level 4 input)", async () => {
		const { release, fixtures } = verified();
		const fake = engine();
		await paritySelfCheck({ release, fixtures, engine: fake.run });
		expect(fake.calls).toHaveLength(1);
		const call = fake.calls[0];
		expect((call?.request as Json).id).toBe("5c4e4d19bb31");
		expect(call?.windows).toEqual(exact().encoding.windows);
		expect(call?.truncated).toBe(false);
	});

	test("accepts engine arithmetic inside the tolerances", async () => {
		const base = exact();
		const result = await check({
			...base,
			questions: {
				risk: {
					kind: "choice",
					logits: { allow: 1.939, ask: -0.401, deny: -2.209 },
					calibrated: { allow: 0.8049, ask: 0.1451, deny: 0.0549 },
				},
			},
			escalateLogit: -2.109,
			classLogits: { "fs.read": 3.209, "fs.write": -1.391 },
		});
		expect(result.ok).toBe(true);
	});

	test("checks a score question's logit", async () => {
		const parity = parityFixtures();
		const [first, second] = parity.fixtures as Json[];
		const scoreFirst = { ...parity, fixtures: [second, first] };
		const observation: ParityObservation = {
			encoding: {
				windows: [
					{ input_ids: [1, 9, 2, 55, 2], segment_ids: [0, 0, 0, 1, 1] },
				],
				truncated: false,
			},
			bucket: "le128",
			questions: { overall: { kind: "score", logit: 0.305 } },
			escalateLogit: null,
			classLogits: {},
		};
		expect((await check(observation, scoreFirst)).ok).toBe(true);
		const off = await check(
			{
				...observation,
				questions: { overall: { kind: "score", logit: 0.32 } },
			},
			scoreFirst,
		);
		expect(problemsOf(off).join("\n")).toContain("overall");
	});
});

describe("paritySelfCheck: level 2, token and segment ids", () => {
	test("refuses one token id off", async () => {
		const base = exact();
		const result = await check({
			...base,
			encoding: {
				windows: [
					{
						input_ids: [1, 7, 42, 44, 2, 99, 100, 2],
						segment_ids: [0, 0, 0, 0, 0, 1, 1, 1],
					},
				],
				truncated: false,
			},
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("mismatch");
		expect(result.error.problems.join("\n")).toContain("input_ids");
	});

	test("refuses different segment ids, window count or truncation", async () => {
		const base = exact();
		const window = base.encoding.windows[0];
		if (window === undefined) throw new Error("no window");
		const segments = await check({
			...base,
			encoding: {
				windows: [{ ...window, segment_ids: [0, 0, 0, 0, 1, 1, 1, 1] }],
				truncated: false,
			},
		});
		expect(problemsOf(segments).join("\n")).toContain("segment_ids");

		const windows = await check({
			...base,
			encoding: { windows: [window, window], truncated: false },
		});
		expect(problemsOf(windows).join("\n")).toContain("windows");

		const truncated = await check({
			...base,
			encoding: { windows: [window], truncated: true },
		});
		expect(problemsOf(truncated).join("\n")).toContain("truncated");
	});
});

describe("paritySelfCheck: level 3, the bucket", () => {
	test("refuses another bucket", async () => {
		const result = await check({ ...exact(), bucket: "le256" });
		expect(problemsOf(result).join("\n")).toContain("bucket");
	});
});

describe("paritySelfCheck: level 4, raw logits within 1e-2", () => {
	test("refuses an option logit 2e-2 off", async () => {
		const result = await check({
			...exact(),
			questions: {
				risk: {
					kind: "choice",
					logits: { allow: 1.95, ask: -0.41, deny: -2.2 },
					calibrated: { allow: 0.8, ask: 0.15, deny: 0.05 },
				},
			},
		});
		expect(problemsOf(result).join("\n")).toContain("risk");
		expect(problemsOf(result).join("\n")).toContain("allow");
	});

	test("refuses a missing option, a missing question, and a non-finite logit", async () => {
		const missingOption = await check({
			...exact(),
			questions: {
				risk: {
					kind: "choice",
					logits: { allow: 1.93, ask: -0.41 },
					calibrated: { allow: 0.8, ask: 0.15 },
				},
			},
		});
		expect(missingOption.ok).toBe(false);

		const missingQuestion = await check({ ...exact(), questions: {} });
		expect(problemsOf(missingQuestion).join("\n")).toContain("risk");

		const nan = await check({
			...exact(),
			questions: {
				risk: {
					kind: "choice",
					logits: { allow: Number.NaN, ask: -0.41, deny: -2.2 },
					calibrated: { allow: 0.8, ask: 0.15, deny: 0.05 },
				},
			},
		});
		expect(nan.ok).toBe(false);
	});

	test("refuses the escalate logit or an action-class logit out of tolerance", async () => {
		const escalate = await check({ ...exact(), escalateLogit: -2.12 });
		expect(problemsOf(escalate).join("\n")).toContain("escalate");

		const noEscalate = await check({ ...exact(), escalateLogit: null });
		expect(problemsOf(noEscalate).join("\n")).toContain("escalate");

		const classes = await check({
			...exact(),
			classLogits: { "fs.read": 3.2, "fs.write": -1.42 },
		});
		expect(problemsOf(classes).join("\n")).toContain("fs.write");

		const missingClass = await check({
			...exact(),
			classLogits: { "fs.read": 3.2 },
		});
		expect(problemsOf(missingClass).join("\n")).toContain("fs.write");
	});
});

describe("paritySelfCheck: level 5, calibrated probabilities within 5e-3", () => {
	test("refuses a probability 6e-3 off", async () => {
		const result = await check({
			...exact(),
			questions: {
				risk: {
					kind: "choice",
					logits: { allow: 1.93, ask: -0.41, deny: -2.2 },
					calibrated: { allow: 0.806, ask: 0.144, deny: 0.05 },
				},
			},
		});
		expect(problemsOf(result).join("\n")).toContain("calibrated");
	});

	test("refuses a distribution in another order than the presented one", async () => {
		const result = await check({
			...exact(),
			questions: {
				risk: {
					kind: "choice",
					logits: { allow: 1.93, ask: -0.41, deny: -2.2 },
					calibrated: { deny: 0.05, ask: 0.15, allow: 0.8 },
				},
			},
		});
		expect(problemsOf(result).join("\n")).toContain("order");
	});
});

describe("paritySelfCheck: the fixtures belong to the verified release", () => {
	test.each([
		[
			"another model",
			(p: Json) => ({
				...p,
				model: { ...(p.model as Json), sha256: "1".repeat(64) },
			}),
		],
		[
			"another model version",
			(p: Json) => ({
				...p,
				model: { ...(p.model as Json), version: "0.1.0" },
			}),
		],
		[
			"another calibration",
			(p: Json) => ({ ...p, calibration_sha256: "2".repeat(64) }),
		],
		[
			"another tokenizer",
			(p: Json) => ({ ...p, tokenizer_sha256: "3".repeat(64) }),
		],
		["another encoding version", (p: Json) => ({ ...p, encoding_version: 2 })],
		[
			"another schema",
			(p: Json) => ({ ...p, schema: "maina-model/parity-fixtures@2" }),
		],
		["no fixtures", (p: Json) => ({ ...p, fixtures: [] })],
		[
			"a malformed first fixture",
			(p: Json) => ({ ...p, fixtures: [{ name: "x" }] }),
		],
	])("refuses fixtures naming %s, without running the engine", async (_label, edit) => {
		const { release, fixtures } = verified(edit(parityFixtures()));
		const fake = engine();
		const result = await paritySelfCheck({
			release,
			fixtures,
			engine: fake.run,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("fixtures_invalid");
		expect(fake.calls).toHaveLength(0);
	});

	test("refuses fixture bytes that are not the verified parity file", async () => {
		const { release } = verified();
		const fake = engine();
		const result = await paritySelfCheck({
			release,
			// The same fixtures, but not the bytes the manifest signed.
			fixtures: utf8(JSON.stringify(parityFixtures(), null, 2)),
			engine: fake.run,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("fixtures_invalid");
		expect(fake.calls).toHaveLength(0);
	});
});

describe("paritySelfCheck: engine failures", () => {
	test("an engine that rejects is a refusal, never a rejection", async () => {
		const { release, fixtures } = verified();
		const result = await paritySelfCheck({
			release,
			fixtures,
			engine: async () => {
				throw new Error("onnxruntime: session failed");
			},
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("engine_failed");
		expect(result.error.message).toContain("session failed");
	});

	test("the refusal message reads as a notice", async () => {
		const result = await check({ ...exact(), bucket: "le256" });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toStartWith(
			"model 0.2.0 failed the parity self-check (short:action.risk:5c4e4d19bb31: ",
		);
	});
});
