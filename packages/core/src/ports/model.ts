import type { ModelTier } from "../ai/tiers";
import type { Result } from "../db/index";

export type ModelRequest = Readonly<{
	tier: ModelTier;
	system: string;
	prompt: string;
	maxTokens?: number;
}>;

export type ModelResponse = Readonly<{
	text: string;
	/** Identifier of the model that produced the text. */
	model: string;
}>;

export type ModelError =
	| Readonly<{ kind: "unavailable"; message: string }>
	| Readonly<{ kind: "failed"; message: string }>;

/** A single LLM call. Provider selection, keys and caching sit behind it. */
export type ModelPort = Readonly<{
	generate: (
		request: ModelRequest,
	) => Promise<Result<ModelResponse, ModelError>>;
}>;
