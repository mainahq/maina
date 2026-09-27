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

type TokenizerError = Readonly<{
	/** `encode_failed`: a tokenizer that loads but cannot encode a text. */
	kind: "tokenizer_invalid" | "encode_failed";
	message: string;
}>;

export type TokenizerPort = Readonly<{
	/**
	 * The token ids of `text`, with no special tokens added. Never throws:
	 * a throw, or an id that is not a non-negative integer (a `tokenizer.json`
	 * whose unknown token is missing from its vocabulary encodes an unknown
	 * word as `undefined`), is `encode_failed`.
	 */
	encode: (text: string) => Result<readonly number[], TokenizerError>;
}>;

const isTokenId = (id: unknown): id is number =>
	typeof id === "number" && Number.isSafeInteger(id) && id >= 0;

const encodeFailed = (message: string): Result<never, TokenizerError> => ({
	ok: false,
	error: { kind: "encode_failed", message: `tokenizer.json: ${message}` },
});

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
			encode: (text) => {
				let ids: readonly unknown[];
				try {
					ids = tokenizer.encode(text, { add_special_tokens: false }).ids;
				} catch (e) {
					return encodeFailed(e instanceof Error ? e.message : String(e));
				}
				const bad = ids.findIndex((id) => !isTokenId(id));
				return bad === -1
					? { ok: true, value: ids as readonly number[] }
					: encodeFailed(`token ${bad} has no id (${String(ids[bad])})`);
			},
		},
	};
}
