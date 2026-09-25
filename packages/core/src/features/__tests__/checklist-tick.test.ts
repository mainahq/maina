import { describe, expect, test } from "bun:test";
import { tickChecklistItem, unattestedTicks } from "../checklist";

const TASKS = `# Verification Tasks: Demo

## Phases

- [ ] **T-001** Test (red): caps markers — covers FR-001
- [ ] **T-002** Implement: marker cap
- [x] **T-003** Already done by hand
`;

describe("tickChecklistItem", () => {
	test("a decide id may tick an item and is recorded as its source", () => {
		const result = tickChecklistItem(TASKS, "T-001", {
			kind: "decide",
			decisionId: "dec-42",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toContain(
			"- [x] **T-001** Test (red): caps markers — covers FR-001 <!-- ticked-by: decide:dec-42 -->",
		);
		// Nothing else changes.
		expect(result.value).toContain("- [ ] **T-002** Implement: marker cap");
	});

	test("a human action may tick an item", () => {
		const result = tickChecklistItem(TASKS, "T-002", {
			kind: "human",
			actor: "bikash",
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toContain(
			"- [x] **T-002** Implement: marker cap <!-- ticked-by: human:bikash -->",
		);
	});

	test("the writing agent cannot tick its own checklist", () => {
		const result = tickChecklistItem(TASKS, "T-001", {
			kind: "agent",
			agentId: "claude-code",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("source_not_allowed");
	});

	test("a malformed decide id is refused", () => {
		for (const decisionId of ["", "has space", "a/b"]) {
			const result = tickChecklistItem(TASKS, "T-001", {
				kind: "decide",
				decisionId,
			});
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error.kind).toBe("invalid_source");
		}
	});

	test("a decide id the log does not know is refused", () => {
		const result = tickChecklistItem(
			TASKS,
			"T-001",
			{ kind: "decide", decisionId: "dec-unknown" },
			{ isKnownDecision: (id) => id === "dec-42" },
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("unknown_decision");
	});

	test("a human tick without an actor is refused", () => {
		const result = tickChecklistItem(TASKS, "T-001", {
			kind: "human",
			actor: " ",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("invalid_source");
	});

	test("an unknown or already ticked item is refused", () => {
		const unknown = tickChecklistItem(TASKS, "T-999", {
			kind: "human",
			actor: "bikash",
		});
		expect(unknown.ok).toBe(false);
		if (!unknown.ok) expect(unknown.error.kind).toBe("item_not_found");

		const done = tickChecklistItem(TASKS, "T-003", {
			kind: "human",
			actor: "bikash",
		});
		expect(done.ok).toBe(false);
		if (!done.ok) expect(done.error.kind).toBe("already_ticked");
	});
});

describe("unattestedTicks", () => {
	test("lists ticked items that carry no decide or human source", () => {
		const ticked = tickChecklistItem(TASKS, "T-001", {
			kind: "decide",
			decisionId: "dec-42",
		});
		expect(ticked.ok).toBe(true);
		if (!ticked.ok) return;
		expect(unattestedTicks(ticked.value)).toEqual([{ item: "T-003", line: 7 }]);
	});
});
