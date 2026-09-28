/**
 * The `spend` producer (#591, spec §6.3, FR-SPD-1): each model call's
 * tokens, cost, model, routed tier and the savings estimate from core
 * `ai/spend.ts`, in integer micro-dollars.
 */

import { describe, expect, test } from "bun:test";
import { type SpendRecord, savingsEstimateUsd } from "@mainahq/core";
import { emitSpend, spendEvent } from "../spend";
import { asWireEvent, capturingSink } from "./helpers";

function call(overrides: Partial<SpendRecord> = {}): SpendRecord {
	return {
		taskId: "task-1",
		task: "review",
		tier: "standard",
		model: "anthropic/claude-sonnet-4.5",
		inputTokens: 18_204,
		outputTokens: 1_377,
		costUsd: 0.075267,
		...overrides,
	};
}

describe("spendEvent", () => {
	test("validates against the pinned schema", () => {
		const input = spendEvent(call());
		const event = asWireEvent(input);
		expect(event.type).toBe("spend");
		expect(event.dataClass).toBe("metadata");
		expect(event.data).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-4.5",
			inputTokens: 18_204,
			outputTokens: 1_377,
			costMicroUsd: 75_267,
			routedTier: "standard",
			savingsMicroUsd: Math.round(savingsEstimateUsd(call()) * 1_000_000),
		});
	});

	test("a bare model id names its provider when the family is known", () => {
		const data = spendEvent(call({ model: "claude-sonnet-4-20250514" })).data;
		expect(data.provider).toBe("anthropic");
		expect(data.model).toBe("claude-sonnet-4-20250514");
		expect(spendEvent(call({ model: "gpt-5-mini" })).data.provider).toBe(
			"openai",
		);
		expect(spendEvent(call({ model: "Gemini-2.5-Flash" })).data).toMatchObject({
			provider: "google",
			model: "gemini-2.5-flash",
		});
	});

	test("an unknown provider or a model that is not a label is `other`", () => {
		const data = spendEvent(call({ model: "acme/internal-model" })).data;
		expect(data.provider).toBe("other");
		expect(data.model).toBe("other");
		const local = spendEvent(call({ model: "qwen2.5-coder:7b" })).data;
		expect(local.model).toBe("other");
		asWireEvent(spendEvent(call({ model: "acme/internal-model" })));
	});

	test("a bare model id of no known family is `other`, as its prefixed form is", () => {
		const bare = spendEvent(call({ model: "acme-internal-model" })).data;
		expect(bare).toMatchObject({ provider: "other", model: "other" });
		expect(JSON.stringify(bare)).not.toContain("acme");
		const ollama = spendEvent(call({ model: "llama3" })).data;
		expect(ollama).toMatchObject({ provider: "other", model: "other" });
	});

	test("the task is the run; its name stays on the machine", () => {
		const input = spendEvent(
			call({ taskId: "0b5c3f5e-2d7a-4a53-9a51-3b1f4f0c9d11" }),
		);
		expect(input.runId).toBe("0b5c3f5e-2d7a-4a53-9a51-3b1f4f0c9d11");
		expect(JSON.stringify(input)).not.toContain("review");
	});

	test("a task id that is not an opaque id is sent as its hash", () => {
		const input = spendEvent(call({ taskId: "/tmp/task one" }));
		expect(input.runId).toMatch(/^task_[0-9a-f]{32}$/);
		asWireEvent(input);
	});
});

describe("emitSpend", () => {
	test("enqueues the event on the sink", () => {
		const { sink, inputs } = capturingSink();
		expect(emitSpend(sink, call()).ok).toBe(true);
		expect(inputs.map((i) => i.type)).toEqual(["spend"]);
	});
});
