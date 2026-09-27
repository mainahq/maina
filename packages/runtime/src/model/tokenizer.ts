/**
 * The System 1 tokenizer (#587, ADR 0050): `@huggingface/tokenizers`, a
 * pure JS implementation, over the model release's `tokenizer.json`. Not
 * `@huggingface/transformers`, which would pull in its own onnxruntime.
 *
 * It encodes with `add_special_tokens: false` (system1-artifact.md §5): the
 * System 1 encoder places its own markers (encoding.md).
 */

import { Tokenizer } from "@huggingface/tokenizers";
import type { Result } from "@mainahq/core";

type TokenizerPort = Readonly<{
	/** The token ids of `text`, with no special tokens added. */
	encode: (text: string) => readonly number[];
}>;

type TokenizerError = Readonly<{
	kind: "tokenizer_invalid";
	message: string;
}>;

const invalid = (e: unknown): Result<never, TokenizerError> => ({
	ok: false,
	error: {
		kind: "tokenizer_invalid",
		message: `tokenizer.json: ${e instanceof Error ? e.message : String(e)}`,
	},
});

/** A tokenizer over the text of a `tokenizer.json`. Never throws. */
export function loadTokenizer(
	json: string,
): Result<TokenizerPort, TokenizerError> {
	let tokenizer: Tokenizer;
	try {
		const parsed: unknown = JSON.parse(json);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return invalid("not a JSON object");
		}
		tokenizer = new Tokenizer(parsed, {});
	} catch (e) {
		return invalid(e);
	}
	return {
		ok: true,
		value: {
			encode: (text) =>
				tokenizer.encode(text, { add_special_tokens: false }).ids,
		},
	};
}
