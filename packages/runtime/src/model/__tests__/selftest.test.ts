/**
 * The packaging self-test (#587): the standalone executable's
 * `model-selftest` mode loads the tokenizer and onnxruntime from a
 * directory laid out like a model release and runs its model once. CI runs
 * it inside the compiled executable on every target it can run (ADR 0050).
 *
 * `MAINA_ORT_NATIVE_DIR` (see engine.test.ts) adds the native engine.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testTmpDir } from "../../__tests__/test-tmp";
import { runModelSelftest, SELFTEST_TEXT } from "../selftest";
import { stageSelftest, TINY_TOKENIZER } from "./fixtures/tiny-model";

let dir = "";

beforeAll(() => {
	dir = testTmpDir("maina-587-selftest-");
	const native = process.env.MAINA_ORT_NATIVE_DIR;
	stageSelftest(
		dir,
		native === undefined ? undefined : { target: "native-test", dir: native },
	);
});

afterAll(() => {
	if (dir === "") return;
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		// Windows cannot delete the addon this process loaded and never
		// unloads: the OS temp directory keeps that copy.
	}
});

describe("runModelSelftest", () => {
	test("tokenizes the probe text and runs the model on the WASM engine", async () => {
		const report = await runModelSelftest({
			dir,
			target: "linux-x64-musl",
			engine: undefined,
		});
		if (!report.ok) throw new Error(report.error.message);
		expect(SELFTEST_TEXT).toBe("git push --force origin main");
		expect(report.value).toMatchObject({
			target: "linux-x64-musl",
			engine: "wasm",
			shadowOnly: true,
			ids: [1, 2, 3, 4, 5, 6],
			// The last token is masked out.
			output: [1, 2, 3, 4, 5, 0],
			ok: true,
		});
		expect(report.value.notice).toContain("shadow");
	});

	test("the engine can be forced", async () => {
		const report = await runModelSelftest({
			dir,
			target: "linux-x64",
			engine: "wasm",
		});
		if (!report.ok) throw new Error(report.error.message);
		expect(report.value).toMatchObject({ engine: "wasm", ok: true });
	});

	test.skipIf(process.env.MAINA_ORT_NATIVE_DIR === undefined)(
		"runs the model on the native engine from ort/<target>/",
		async () => {
			const report = await runModelSelftest({
				dir,
				target: "native-test",
				engine: "native",
			});
			if (!report.ok) throw new Error(report.error.message);
			expect(report.value).toMatchObject({
				engine: "native",
				output: [1, 2, 3, 4, 5, 0],
				ok: true,
			});
		},
	);

	test("an unknown target with no engine given is an error", async () => {
		const report = await runModelSelftest({
			dir,
			target: "freebsd-x64",
			engine: undefined,
		});
		expect(report.ok).toBe(false);
		if (!report.ok) expect(report.error.kind).toBe("unsupported_target");
	});

	test("a directory without the model files is an error", async () => {
		const empty = testTmpDir("maina-587-empty-");
		try {
			const report = await runModelSelftest({
				dir: empty,
				target: "linux-x64",
				engine: "wasm",
			});
			expect(report.ok).toBe(false);
			if (!report.ok) {
				expect(report.error.kind).toBe("missing_file");
				expect(report.error.message).toContain("tokenizer.json");
			}
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});

	test("a tokenizer that encodes the probe to non-ids is an error, not a throw", async () => {
		const broken = testTmpDir("maina-587-badtok-");
		try {
			stageSelftest(broken);
			// `main` is unknown and the unknown token is not in the vocabulary.
			const { main: _main, ...vocab } = TINY_TOKENIZER.model.vocab;
			writeFileSync(
				join(broken, "tokenizer.json"),
				JSON.stringify({
					...TINY_TOKENIZER,
					model: { ...TINY_TOKENIZER.model, unk_token: "[MISSING]", vocab },
				}),
			);
			const report = await runModelSelftest({
				dir: broken,
				target: "linux-x64",
				engine: "wasm",
			});
			expect(report.ok).toBe(false);
			if (!report.ok) expect(report.error.kind).toBe("encode_failed");
		} finally {
			rmSync(broken, { recursive: true, force: true });
		}
	});

	test("a native engine with no addon for the target is an error", async () => {
		const report = await runModelSelftest({
			dir,
			target: "linux-arm64",
			engine: "native",
		});
		expect(report.ok).toBe(false);
		if (!report.ok) expect(report.error.kind).toBe("engine_load_failed");
	});
});
