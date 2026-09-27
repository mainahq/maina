/**
 * The System 1 tokenizer (#587, ADR 0050): `@huggingface/tokenizers`, pure
 * JS, over the release's `tokenizer.json`, encoding with
 * `add_special_tokens: false` (system1-artifact.md §5): the encoder adds
 * its own markers (encoding.md).
 */

import { describe, expect, test } from "bun:test";
import { loadTokenizer } from "../tokenizer";
import { TINY_TOKENIZER } from "./fixtures/tiny-model";

describe("loadTokenizer", () => {
	test("encodes text to the tokenizer's ids, subwords included", () => {
		const loaded = loadTokenizer(JSON.stringify(TINY_TOKENIZER));
		if (!loaded.ok) throw new Error(loaded.error.message);
		expect(loaded.value.encode("git push --force origin main")).toEqual({
			ok: true,
			value: [1, 2, 3, 4, 5, 6],
		});
		expect(loaded.value.encode("git frobnicate")).toEqual({
			ok: true,
			value: [1, 0],
		});
		expect(loaded.value.encode("")).toEqual({ ok: true, value: [] });
	});

	test("never adds the tokenizer's special tokens", () => {
		const withTemplate = {
			...TINY_TOKENIZER,
			added_tokens: [
				...TINY_TOKENIZER.added_tokens,
				{ ...TINY_TOKENIZER.added_tokens[0], id: 7, content: "[CLS]" },
			],
			post_processor: {
				type: "TemplateProcessing",
				single: [
					{ SpecialToken: { id: "[CLS]", type_id: 0 } },
					{ Sequence: { id: "A", type_id: 0 } },
				],
				pair: [
					{ SpecialToken: { id: "[CLS]", type_id: 0 } },
					{ Sequence: { id: "A", type_id: 0 } },
					{ Sequence: { id: "B", type_id: 1 } },
				],
				special_tokens: {
					"[CLS]": { id: "[CLS]", ids: [7], tokens: ["[CLS]"] },
				},
			},
			model: {
				...TINY_TOKENIZER.model,
				vocab: { ...TINY_TOKENIZER.model.vocab, "[CLS]": 7 },
			},
		};
		const loaded = loadTokenizer(JSON.stringify(withTemplate));
		if (!loaded.ok) throw new Error(loaded.error.message);
		expect(loaded.value.encode("git push")).toEqual({
			ok: true,
			value: [1, 2],
		});
	});

	test("ids that are not token ids are an error, not a throw", () => {
		// It loads, but its unknown token is missing from the vocabulary, so
		// @huggingface/tokenizers encodes an unknown word as `undefined`.
		const loaded = loadTokenizer(
			JSON.stringify({
				...TINY_TOKENIZER,
				model: { ...TINY_TOKENIZER.model, unk_token: "[MISSING]" },
			}),
		);
		if (!loaded.ok) throw new Error(loaded.error.message);
		expect(loaded.value.encode("git push")).toEqual({
			ok: true,
			value: [1, 2],
		});
		const encoded = loaded.value.encode("git frobnicate");
		expect(encoded.ok).toBe(false);
		if (!encoded.ok) expect(encoded.error.kind).toBe("encode_failed");
	});

	test("text that is not JSON is an error, not a throw", () => {
		const loaded = loadTokenizer("{not json");
		expect(loaded.ok).toBe(false);
		if (!loaded.ok) expect(loaded.error.kind).toBe("tokenizer_invalid");
	});

	test("JSON that is not a tokenizer is an error, not a throw", () => {
		for (const text of ["null", "[]", '{"model":{"type":"Nope"}}']) {
			const loaded = loadTokenizer(text);
			expect(loaded.ok).toBe(false);
			if (!loaded.ok) expect(loaded.error.kind).toBe("tokenizer_invalid");
		}
	});
});
