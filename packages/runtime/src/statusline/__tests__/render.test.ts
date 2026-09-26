/**
 * Status line render (FR-RET-1, #347): one line of at most 80 visible
 * characters, pure and deterministic, "Maina: off" when the runtime is down.
 */

import { describe, expect, test } from "bun:test";
import type { SessionSummary } from "@mainahq/core";
import {
	renderStatusline,
	STATUSLINE_MAX_WIDTH,
	visibleWidth,
} from "../render";
import type { DegradedPart, StatuslineState } from "../state";

const SUMMARY: SessionSummary = {
	blocked: 1,
	asked: 2,
	allowed: 14,
	routed: 5,
	estimatedSavedUsd: 0.42,
	addedLatencyP95: 38,
};

const on = (
	summary: SessionSummary | null,
	degraded: readonly DegradedPart[] = [],
): StatuslineState => ({ runtime: "on", degraded, summary });

describe("renderStatusline", () => {
	test("a runtime that is down renders Maina: off", () => {
		expect(renderStatusline({ runtime: "off" })).toBe("Maina: off");
	});

	test("shows the session's live numbers", () => {
		expect(renderStatusline(on(SUMMARY))).toBe(
			"Maina: on · 1 blocked · 2 asked · 14 allowed · 5 routed ~$0.42 saved · +38ms p95",
		);
	});

	test("a session with no decisions yet says so", () => {
		expect(renderStatusline(on(null))).toBe("Maina: on · no decisions yet");
	});

	test("routing that cost more is shown as extra, not saved", () => {
		const line = renderStatusline(
			on({ ...SUMMARY, estimatedSavedUsd: -1.5, addedLatencyP95: null }),
		);
		expect(line).toBe(
			"Maina: on · 1 blocked · 2 asked · 14 allowed · 5 routed ~$1.50 extra",
		);
	});

	test("shows the degraded state and which part is degraded", () => {
		expect(renderStatusline(on(SUMMARY, ["gate"]))).toStartWith(
			"Maina: degraded (gate) · 1 blocked",
		);
		expect(renderStatusline(on(null, ["runtime"]))).toBe(
			"Maina: degraded (runtime) · no decisions yet",
		);
		expect(renderStatusline(on(null, ["runtime", "gate"]))).toStartWith(
			"Maina: degraded (runtime, gate)",
		);
	});

	test("is pure and deterministic", () => {
		const state = Object.freeze(on(Object.freeze({ ...SUMMARY }), ["gate"]));
		const first = renderStatusline(state);
		for (let i = 0; i < 100; i++) expect(renderStatusline(state)).toBe(first);
		expect(state).toEqual(on(SUMMARY, ["gate"]));
		expect(renderStatusline({ runtime: "off" }, { color: true })).toBe(
			renderStatusline({ runtime: "off" }, { color: true }),
		);
	});

	test("never exceeds 80 visible characters", () => {
		const huge: SessionSummary = {
			blocked: 123_456,
			asked: 234_567,
			allowed: 9_876_543,
			routed: 45_678,
			estimatedSavedUsd: 98_765.43,
			addedLatencyP95: 123_456,
		};
		for (const color of [false, true]) {
			for (const state of [
				on(huge),
				on(huge, ["runtime", "gate"]),
				on(SUMMARY, ["runtime", "gate"]),
				on(null, ["runtime", "gate"]),
				{ runtime: "off" } as const,
			]) {
				const line = renderStatusline(state, { color });
				expect(visibleWidth(line)).toBeLessThanOrEqual(STATUSLINE_MAX_WIDTH);
				expect(line).not.toContain("\n");
				expect(line).toStartWith(color ? "\x1b[" : "Maina");
			}
		}
	});

	test("drops trailing parts rather than cutting a number", () => {
		const line = renderStatusline(
			on(
				{
					blocked: 123_456,
					asked: 234_567,
					allowed: 9_876_543,
					routed: 45_678,
					estimatedSavedUsd: 98_765.43,
					addedLatencyP95: 123_456,
				},
				["runtime", "gate"],
			),
		);
		expect(line).toBe(
			"Maina: degraded (runtime, gate) · 123456 blocked · 234567 asked",
		);
	});

	test("a hand-built summary with bad numbers never renders NaN", () => {
		const line = renderStatusline(
			on({
				blocked: Number.NaN,
				asked: -3,
				allowed: 2.7,
				routed: Number.POSITIVE_INFINITY,
				estimatedSavedUsd: Number.NaN,
				addedLatencyP95: Number.NaN,
			}),
		);
		expect(line).not.toMatch(/NaN|Infinity|-/);
		expect(line).toBe("Maina: on · 0 blocked · 0 asked · 2 allowed");
	});

	test("colour codes add no visible width", () => {
		const plain = renderStatusline(on(SUMMARY, ["gate"]));
		const coloured = renderStatusline(on(SUMMARY, ["gate"]), { color: true });
		expect(coloured).not.toBe(plain);
		expect(visibleWidth(coloured)).toBe(visibleWidth(plain));
	});

	test("renders within 50 ms at p95", () => {
		const samples: number[] = [];
		const state = on(SUMMARY, ["gate"]);
		for (let i = 0; i < 2000; i++) {
			const t0 = performance.now();
			renderStatusline(state, { color: true });
			samples.push(performance.now() - t0);
		}
		samples.sort((a, b) => a - b);
		const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
		expect(p95).toBeLessThan(50);
	});
});
