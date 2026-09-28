/**
 * The `spend` event (#591, spec §6.3, FR-SPD-1): one per model call, fed by
 * core's spend-ledger port (`createSpendLedger`'s `onRecorded`).
 *
 * Tokens, cost and the savings estimate (core `savingsEstimateUsd`) in
 * integer micro-dollars, the provider, the model and the routed tier, under
 * the task's id as the run. The task's name stays on the machine.
 *
 * A model id is sent only when it is recognisably a model: an OpenRouter id
 * (`<provider>/<model>`) from a known provider, or a bare id whose family
 * names its provider. Anything else, a local model path say, is `other`:
 * `src/model.gguf` has the shape of an OpenRouter id, so the provider list
 * is what tells them apart.
 */

import { createHash } from "node:crypto";
import {
	type Result,
	type SpendRecord,
	savingsEstimateUsd,
} from "@mainahq/core";
import type { EventInput } from "../outbox";
import type { UplinkError } from "../uplink";
import {
	count,
	type Emitted,
	type EventSink,
	emit,
	isLabel,
	isOpaqueId,
	label,
} from "./emit";

const MICRO = 1_000_000;
const OTHER = "other";

/** Providers whose OpenRouter ids are sent as they are. */
const PROVIDERS: ReadonlySet<string> = new Set([
	"anthropic",
	"openai",
	"google",
	"meta-llama",
	"mistralai",
	"deepseek",
	"qwen",
	"x-ai",
	"cohere",
	"amazon",
	"microsoft",
	"nvidia",
	"moonshotai",
	"z-ai",
]);

/** A bare model id's provider, by its family prefix. */
const FAMILIES: readonly (readonly [RegExp, string])[] = [
	[/^claude-/, "anthropic"],
	[/^(gpt-|o[134](-|$))/, "openai"],
	[/^gemini-/, "google"],
];

type Model = Readonly<{ provider: string; model: string }>;

function modelOf(id: string): Model {
	const lower = id.toLowerCase();
	const parts = lower.split("/");
	if (parts.length === 2) {
		const [provider = "", model = ""] = parts;
		return PROVIDERS.has(provider) && isLabel(model)
			? { provider, model }
			: { provider: OTHER, model: OTHER };
	}
	if (parts.length !== 1 || !isLabel(lower)) {
		return { provider: OTHER, model: OTHER };
	}
	const family = FAMILIES.find(([pattern]) => pattern.test(lower));
	return { provider: family?.[1] ?? OTHER, model: lower };
}

/**
 * The event's `runId` (the schema requires one on `spend`): the ledger's
 * task id, a random UUID per command, so the cloud can total a task. One
 * that is not an opaque id is sent as a hash instead, never as it is.
 */
function runIdOf(taskId: string): string {
	if (isOpaqueId(taskId)) return taskId;
	const digest = createHash("sha256").update(taskId, "utf-8").digest("hex");
	return `task_${digest.slice(0, 32)}`;
}

/** `record` as a metadata `spend` event. */
export function spendEvent(record: SpendRecord): EventInput {
	const { provider, model } = modelOf(record.model);
	return {
		type: "spend",
		runId: runIdOf(record.taskId),
		data: {
			provider,
			model,
			inputTokens: count(record.inputTokens),
			outputTokens: count(record.outputTokens),
			costMicroUsd: count(record.costUsd * MICRO),
			routedTier: label(record.tier),
			savingsMicroUsd: count(savingsEstimateUsd(record) * MICRO),
		},
	};
}

export function emitSpend(
	sink: EventSink,
	record: SpendRecord,
): Result<Emitted, UplinkError> {
	return emit(sink, spendEvent(record));
}
