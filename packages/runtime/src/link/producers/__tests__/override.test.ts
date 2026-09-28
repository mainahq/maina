/**
 * The `override` producer (#591, spec §6.3): each gate override becomes one
 * metadata event naming the decision type and the actions, never the
 * command or path that was overridden.
 */

import { describe, expect, test } from "bun:test";
import type { OverrideFact } from "@mainahq/core";
import { emitOverride, overrideEvent } from "../override";
import { asWireEvent, capturingSink } from "./helpers";

const FACT: OverrideFact = {
	decisionId: "d-1",
	decisionType: "action.risk",
	fromAction: "deny",
	toAction: "allow",
	reason: "member_override",
};

describe("overrideEvent", () => {
	test("validates against the pinned schema", () => {
		const input = overrideEvent(FACT);
		expect(input).not.toBeNull();
		if (input === null) return;
		const event = asWireEvent(input);
		expect(event.type).toBe("override");
		expect(event.dataClass).toBe("metadata");
		expect(event.data).toEqual({
			decisionType: "action.risk",
			fromAction: "deny",
			toAction: "allow",
			reason: "member_override",
		});
	});

	test("the local decision id stays on the machine", () => {
		expect(JSON.stringify(overrideEvent(FACT))).not.toContain("d-1");
	});

	test("an action that is not a label is sent as `unknown`", () => {
		const input = overrideEvent({ ...FACT, fromAction: "git push --force" });
		expect(input?.data.fromAction).toBe("unknown");
		if (input !== null) asWireEvent(input);
	});
});

describe("emitOverride", () => {
	test("enqueues the event on the sink", () => {
		const { sink, inputs } = capturingSink();
		expect(emitOverride(sink, FACT).ok).toBe(true);
		expect(inputs.map((i) => i.type)).toEqual(["override"]);
	});
});
