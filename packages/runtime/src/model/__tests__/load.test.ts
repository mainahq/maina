/**
 * Loading a cached System 1 release (#338, system1-artifact.md §3 steps
 * 1–5): the cached directory is verified again (every hash and signature),
 * then the tokenizer, `metadata.json` and `calibration.json` are read and
 * checked, the engine is opened from the verified files, and the first
 * parity fixture runs through the loader's own path. Any failure refuses
 * the model with the notice the runtime shows (§8); the runtime then falls
 * back to the built-in backends.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModel } from "../load";
import { checkerFor, devKey, pinOn, sha256 } from "./fixtures/model-release";
import {
	buildSystem1Release,
	S1_VERSION,
	writeRelease,
} from "./fixtures/system1-release";

const MUSL = "linux-x64-musl";
const LOAD_TIMEOUT = 30_000;

let key: ReturnType<typeof devKey>;
let scratch: string;

beforeAll(() => {
	key = devKey();
	scratch = mkdtempSync(join(tmpdir(), "maina-338-load-"));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;

/** A cache root holding `release`, verified as `pullModel` leaves it. */
function cached(release: ReturnType<typeof buildSystem1Release>) {
	const root = join(scratch, `root-${++n}`);
	const dir = join(root, "maina-system1", S1_VERSION);
	writeRelease(dir, release.files);
	return {
		dir,
		input: {
			pin: pinOn(release.manifestBytes, S1_VERSION),
			root,
			verifySignature: checkerFor(key.publicPem),
		},
	};
}

const USING = "; using rules and heuristics";

describe("loadModel", () => {
	test(
		"verifies the cache, opens the engine and passes the parity self-check",
		async () => {
			const release = buildSystem1Release(key.privatePem);
			const { input } = cached(release);
			const loaded = await loadModel({ ...input, target: MUSL });
			if (!loaded.ok) throw new Error(loaded.error.notice);
			const model = loaded.value;
			expect(model.engine).toBe("wasm");
			// No native build for musl: shadow only, with the engine's notice.
			expect(model.shadowOnly).toBe(true);
			expect(model.notice).toContain("shadow");
			const calibrationSha = sha256(
				release.files.get("calibration.json") as Uint8Array,
			);
			const modelSha = sha256(
				release.files.get("model.int8.onnx") as Uint8Array,
			);
			expect(model.version).toBe(
				`${S1_VERSION}+${modelSha.slice(0, 12)}+${calibrationSha.slice(0, 12)}/onnxruntime-web`,
			);
			expect(model.backendCalibration.sha256).toBe(calibrationSha);
			expect(
				model.backendCalibration.thresholds["diff.sensitive"]?.confidence,
			).toBe(0.5);
			// action.risk applies its own thresholds: no confidence to act at.
			expect(model.backendCalibration.thresholds["action.risk"]).toBe(
				undefined,
			);
			await model.session.dispose();
		},
		LOAD_TIMEOUT,
	);

	test("a tampered artifact is refused with the notice", async () => {
		const { dir, input } = cached(buildSystem1Release(key.privatePem));
		const path = join(dir, "model.int8.onnx");
		const bytes = new Uint8Array(readFileSync(path));
		bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
		writeFileSync(path, bytes);
		const loaded = await loadModel({ ...input, target: MUSL });
		expect(loaded.ok).toBe(false);
		if (!loaded.ok) {
			expect(loaded.error.kind).toBe("unverified");
			expect(loaded.error.notice).toBe(
				`system1: model ${S1_VERSION} failed verification (model int8: sha256 mismatch)${USING}`,
			);
		}
	});

	test("a release that was never pulled is not installed", async () => {
		const { input } = cached(buildSystem1Release(key.privatePem));
		const loaded = await loadModel({
			...input,
			root: join(scratch, "empty"),
			target: MUSL,
		});
		expect(loaded.ok).toBe(false);
		if (!loaded.ok) {
			expect(loaded.error.kind).toBe("not_installed");
			expect(loaded.error.notice).toContain("maina model pull");
		}
	});

	test.each([
		[
			"metadata of another schema",
			(m: Record<string, unknown>) => ({ ...m, schema: "maina-model/x@9" }),
			"metadata.json",
		],
		[
			"an encoding this loader does not implement",
			(m: Record<string, unknown>) => ({
				...m,
				encoding: { ...(m.encoding as object), version: 2 },
			}),
			"encoding",
		],
		[
			"an option vocabulary that does not match the graph",
			(m: Record<string, unknown>) => ({
				...m,
				option_vocab: (m.option_vocab as unknown[]).slice(1),
			}),
			"option_vocab",
		],
	])(
		"a signed release with %s is refused",
		async (_, metadata, mentions) => {
			const { input } = cached(
				buildSystem1Release(key.privatePem, { metadata }),
			);
			const loaded = await loadModel({ ...input, target: MUSL });
			expect(loaded.ok).toBe(false);
			if (!loaded.ok) {
				expect(loaded.error.kind).toBe("invalid_artifact");
				expect(loaded.error.notice).toContain(mentions);
				expect(loaded.error.notice.endsWith(USING)).toBe(true);
			}
		},
		LOAD_TIMEOUT,
	);

	test(
		"a release whose parity fixtures disagree with the loader is refused",
		async () => {
			const parity = (p: Record<string, unknown>) => {
				const [first] = p.fixtures as Record<string, unknown>[];
				const questions = first?.questions as Record<
					string,
					Record<string, unknown>
				>;
				const risk = questions.risk as { logits: Record<string, number> };
				return {
					...p,
					fixtures: [
						{
							...first,
							questions: {
								risk: {
									...risk,
									logits: { ...risk.logits, deny: (risk.logits.deny ?? 0) + 1 },
								},
							},
						},
					],
				};
			};
			const { input } = cached(buildSystem1Release(key.privatePem, { parity }));
			const loaded = await loadModel({ ...input, target: MUSL });
			expect(loaded.ok).toBe(false);
			if (!loaded.ok) {
				expect(loaded.error.kind).toBe("parity_failed");
				expect(loaded.error.notice).toContain("parity self-check");
				expect(loaded.error.notice).toContain("logit deny");
			}
		},
		LOAD_TIMEOUT,
	);

	test(
		"a native target whose engine will not load falls back to WASM, shadow only",
		async () => {
			// The release ships no `ort/linux-x64/` files, so the addon is missing.
			const { input } = cached(buildSystem1Release(key.privatePem));
			const loaded = await loadModel({ ...input, target: "linux-x64" });
			if (!loaded.ok) throw new Error(loaded.error.notice);
			expect(loaded.value.engine).toBe("wasm");
			expect(loaded.value.shadowOnly).toBe(true);
			expect(loaded.value.notice).toContain("native");
			expect(loaded.value.notice).toContain("shadow");
			expect(loaded.value.version.endsWith("/onnxruntime-web")).toBe(true);
			await loaded.value.session.dispose();
		},
		LOAD_TIMEOUT,
	);

	test("a native load error with no usable WASM is refused", async () => {
		const { input } = cached(
			buildSystem1Release(key.privatePem, { noWasm: true }),
		);
		const loaded = await loadModel({ ...input, target: "linux-x64" });
		expect(loaded.ok).toBe(false);
		if (!loaded.ok) {
			expect(loaded.error.kind).toBe("engine_failed");
			expect(loaded.error.notice.endsWith(USING)).toBe(true);
		}
	});

	test("an injected engine opener is used for the target's engine", async () => {
		const { input } = cached(buildSystem1Release(key.privatePem));
		const asked: string[] = [];
		const loaded = await loadModel({
			...input,
			target: "linux-x64",
			openSession: async (request) => {
				asked.push(`${request.engine}:${request.target}`);
				return {
					ok: false,
					error: {
						kind: "engine_load_failed",
						engine: request.engine,
						message: "no engine here",
					},
				};
			},
		});
		expect(asked).toEqual(["native:linux-x64", "wasm:linux-x64"]);
		expect(loaded.ok).toBe(false);
		if (!loaded.ok) expect(loaded.error.notice).toContain("no engine here");
	});
});
