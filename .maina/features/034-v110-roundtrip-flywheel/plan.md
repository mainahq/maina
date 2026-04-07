# Feature 034: v1.1.0 Round-Trip Flywheel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect MCP tool results to cache and feedback systems so the RL flywheel has real data after every tool call.

**Architecture:** Add `captureResult()` to wrap every MCP tool handler — caching outputs for instant replay (reviewCode only, since its input contains actual diff content), recording feedback for prompt evolution, and tracking tool usage stats. Add implicit accept/reject signals from downstream actions (commit success → accept prior review/verify, re-run → reject previous result).

**Tech Stack:** Bun, TypeScript, bun:sqlite, bun:test

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/core/src/db/index.ts` | Add `tool_usage` table to stats DB |
| Create | `packages/core/src/feedback/capture.ts` | `captureResult()`, `getCachedResult()`, `buildToolCacheKey()` |
| Create | `packages/core/src/feedback/__tests__/capture.test.ts` | Tests for capture module |
| Modify | `packages/core/src/stats/tracker.ts` | Add `trackToolUsage()`, `getToolUsageStats()` |
| Create | `packages/core/src/stats/__tests__/tool-usage.test.ts` | Tests for tool usage tracking |
| Create | `packages/core/src/feedback/signals.ts` | `emitAcceptSignal()`, `emitRejectSignal()` |
| Create | `packages/core/src/feedback/__tests__/signals.test.ts` | Tests for signals module |
| Modify | `packages/mcp/src/tools/review.ts` | Add cache check + captureResult, remove old recordFeedbackAsync |
| Modify | `packages/mcp/src/tools/verify.ts` | Add captureResult to both handlers |
| Modify | `packages/mcp/src/tools/context.ts` | Add captureResult to both handlers |
| Modify | `packages/mcp/src/tools/features.ts` | Add captureResult to both handlers |
| Modify | `packages/mcp/src/tools/explain.ts` | Add captureResult |
| Modify | `packages/cli/src/commands/commit.ts` | Add `emitAcceptSignal` on success |
| Modify | `packages/core/src/index.ts` | Export new functions and types |

---

### Task 1: Add tool_usage Table + Tracking Functions

**Files:**
- Modify: `packages/core/src/db/index.ts:120-152`
- Modify: `packages/core/src/stats/tracker.ts`
- Create: `packages/core/src/stats/__tests__/tool-usage.test.ts`

- [ ] **Step 1: Write failing test for tool_usage table creation**

```typescript
// packages/core/src/stats/__tests__/tool-usage.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getStatsDb } from "../../db/index";
import { getToolUsageStats, trackToolUsage } from "../tracker";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-tool-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe("tool_usage table", () => {
	test("getStatsDb creates tool_usage table", () => {
		const result = getStatsDb(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const { db } = result.value;
		const tables = db
			.query(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='tool_usage'",
			)
			.all();
		expect(tables).toHaveLength(1);
	});
});

describe("trackToolUsage", () => {
	test("inserts a tool usage row", () => {
		trackToolUsage(tmpDir, {
			tool: "reviewCode",
			inputHash: "abc123",
			durationMs: 150,
			cacheHit: false,
		});

		const result = getStatsDb(tmpDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const { db } = result.value;
		const rows = db.query("SELECT * FROM tool_usage").all() as Array<{
			tool: string;
			duration_ms: number;
			cache_hit: number;
		}>;
		expect(rows).toHaveLength(1);
		expect(rows[0].tool).toBe("reviewCode");
		expect(rows[0].duration_ms).toBe(150);
		expect(rows[0].cache_hit).toBe(0);
	});

	test("tracks cache hit", () => {
		trackToolUsage(tmpDir, {
			tool: "reviewCode",
			inputHash: "abc123",
			durationMs: 0,
			cacheHit: true,
		});

		const result = getStatsDb(tmpDir);
		if (!result.ok) return;

		const { db } = result.value;
		const rows = db
			.query("SELECT * FROM tool_usage WHERE cache_hit = 1")
			.all();
		expect(rows).toHaveLength(1);
	});

	test("stores workflow_id when provided", () => {
		trackToolUsage(tmpDir, {
			tool: "verify",
			inputHash: "def456",
			durationMs: 200,
			cacheHit: false,
			workflowId: "wf-123",
		});

		const result = getStatsDb(tmpDir);
		if (!result.ok) return;

		const { db } = result.value;
		const row = db.query("SELECT workflow_id FROM tool_usage").get() as {
			workflow_id: string;
		} | null;
		expect(row?.workflow_id).toBe("wf-123");
	});
});

describe("getToolUsageStats", () => {
	test("returns stats across multiple tool calls", () => {
		trackToolUsage(tmpDir, {
			tool: "reviewCode",
			inputHash: "a",
			durationMs: 100,
			cacheHit: false,
		});
		trackToolUsage(tmpDir, {
			tool: "reviewCode",
			inputHash: "b",
			durationMs: 200,
			cacheHit: true,
		});
		trackToolUsage(tmpDir, {
			tool: "verify",
			inputHash: "c",
			durationMs: 50,
			cacheHit: false,
		});

		const stats = getToolUsageStats(tmpDir);
		expect(stats.totalCalls).toBe(3);
		expect(stats.cacheHits).toBe(1);
		expect(stats.cacheHitRate).toBeCloseTo(1 / 3, 2);
		expect(stats.byTool.reviewCode.calls).toBe(2);
		expect(stats.byTool.reviewCode.cacheHits).toBe(1);
		expect(stats.byTool.verify.calls).toBe(1);
	});

	test("returns empty stats when no data", () => {
		const stats = getToolUsageStats(tmpDir);
		expect(stats.totalCalls).toBe(0);
		expect(stats.cacheHitRate).toBe(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/stats/__tests__/tool-usage.test.ts`
Expected: FAIL — `tool_usage` table does not exist, `trackToolUsage` not found

- [ ] **Step 3: Add tool_usage table to createStatsTables in db/index.ts**

In `packages/core/src/db/index.ts`, inside `createStatsTables` after the `commit_snapshots` table creation and migration (line 151), add:

```typescript
	db.exec(`
		CREATE TABLE IF NOT EXISTS tool_usage (
			id TEXT PRIMARY KEY,
			tool TEXT NOT NULL,
			input_hash TEXT NOT NULL,
			duration_ms INTEGER NOT NULL,
			cache_hit INTEGER NOT NULL DEFAULT 0,
			timestamp TEXT NOT NULL,
			workflow_id TEXT
		);
	`);
```

- [ ] **Step 4: Add trackToolUsage and getToolUsageStats to stats/tracker.ts**

At the end of `packages/core/src/stats/tracker.ts`, add:

```typescript
// ── Tool Usage Tracking ─────────────────────────────────────────────────────

export interface ToolUsageInput {
	tool: string;
	inputHash: string;
	durationMs: number;
	cacheHit: boolean;
	workflowId?: string;
}

export interface ToolUsageStats {
	totalCalls: number;
	cacheHits: number;
	cacheHitRate: number;
	byTool: Record<
		string,
		{ calls: number; cacheHits: number; avgDurationMs: number }
	>;
}

/**
 * Track an MCP tool invocation in the stats database.
 * Fire-and-forget — never throws.
 */
export function trackToolUsage(
	mainaDir: string,
	input: ToolUsageInput,
): void {
	try {
		const dbResult = getStatsDb(mainaDir);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const id = crypto.randomUUID();
		const timestamp = new Date().toISOString();

		db.prepare(
			`INSERT INTO tool_usage (id, tool, input_hash, duration_ms, cache_hit, timestamp, workflow_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(
			id,
			input.tool,
			input.inputHash,
			input.durationMs,
			input.cacheHit ? 1 : 0,
			timestamp,
			input.workflowId ?? null,
		);
	} catch {
		// Never throw from stats tracking
	}
}

/**
 * Get aggregated tool usage statistics.
 */
export function getToolUsageStats(mainaDir: string): ToolUsageStats {
	const empty: ToolUsageStats = {
		totalCalls: 0,
		cacheHits: 0,
		cacheHitRate: 0,
		byTool: {},
	};
	try {
		const dbResult = getStatsDb(mainaDir);
		if (!dbResult.ok) return empty;

		const { db } = dbResult.value;

		const totals = db
			.query(
				`SELECT COUNT(*) as total,
				        SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) as hits
				 FROM tool_usage`,
			)
			.get() as { total: number; hits: number } | null;

		if (!totals || totals.total === 0) return empty;

		const byToolRows = db
			.query(
				`SELECT tool,
				        COUNT(*) as calls,
				        SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) as cache_hits,
				        AVG(duration_ms) as avg_duration
				 FROM tool_usage GROUP BY tool`,
			)
			.all() as Array<{
			tool: string;
			calls: number;
			cache_hits: number;
			avg_duration: number;
		}>;

		const byTool: Record<
			string,
			{ calls: number; cacheHits: number; avgDurationMs: number }
		> = {};
		for (const row of byToolRows) {
			byTool[row.tool] = {
				calls: row.calls,
				cacheHits: row.cache_hits,
				avgDurationMs: Math.round(row.avg_duration),
			};
		}

		return {
			totalCalls: totals.total,
			cacheHits: totals.hits,
			cacheHitRate: totals.total > 0 ? totals.hits / totals.total : 0,
			byTool,
		};
	} catch {
		return empty;
	}
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/core/src/stats/__tests__/tool-usage.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/index.ts packages/core/src/stats/tracker.ts packages/core/src/stats/__tests__/tool-usage.test.ts
git commit -m "feat(core): add tool_usage table and tracking functions for MCP flywheel"
```

---

### Task 2: Create capture.ts — Result Capture + Cache

**Files:**
- Create: `packages/core/src/feedback/capture.ts`
- Create: `packages/core/src/feedback/__tests__/capture.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/feedback/__tests__/capture.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createCacheManager } from "../../cache/manager";
import { buildToolCacheKey, captureResult, getCachedResult } from "../capture";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe("buildToolCacheKey", () => {
	test("returns consistent hash for same inputs", () => {
		const key1 = buildToolCacheKey("reviewCode", { diff: "hello" });
		const key2 = buildToolCacheKey("reviewCode", { diff: "hello" });
		expect(key1).toBe(key2);
	});

	test("returns different hash for different tool names", () => {
		const key1 = buildToolCacheKey("reviewCode", { diff: "hello" });
		const key2 = buildToolCacheKey("verify", { diff: "hello" });
		expect(key1).not.toBe(key2);
	});

	test("returns different hash for different inputs", () => {
		const key1 = buildToolCacheKey("reviewCode", { diff: "hello" });
		const key2 = buildToolCacheKey("reviewCode", { diff: "world" });
		expect(key1).not.toBe(key2);
	});
});

describe("getCachedResult", () => {
	test("returns null on cache miss", () => {
		const result = getCachedResult("reviewCode", { diff: "test" }, tmpDir);
		expect(result).toBeNull();
	});

	test("returns cached value after captureResult stores it", () => {
		captureResult({
			tool: "reviewCode",
			input: { diff: "test-diff" },
			output: '{"passed": true}',
			durationMs: 100,
			mainaDir: tmpDir,
		});

		const cached = getCachedResult(
			"reviewCode",
			{ diff: "test-diff" },
			tmpDir,
		);
		expect(cached).toBe('{"passed": true}');
	});

	test("returns null for different input", () => {
		captureResult({
			tool: "reviewCode",
			input: { diff: "original" },
			output: '{"passed": true}',
			durationMs: 100,
			mainaDir: tmpDir,
		});

		const cached = getCachedResult(
			"reviewCode",
			{ diff: "modified" },
			tmpDir,
		);
		expect(cached).toBeNull();
	});
});

describe("captureResult", () => {
	test("stores result in cache", () => {
		captureResult({
			tool: "verify",
			input: { files: ["a.ts"] },
			output: '{"passed": true, "findings": []}',
			durationMs: 50,
			mainaDir: tmpDir,
		});

		const cache = createCacheManager(tmpDir);
		const key = buildToolCacheKey("verify", { files: ["a.ts"] });
		const entry = cache.get(key);
		expect(entry).not.toBeNull();
		expect(entry?.value).toBe('{"passed": true, "findings": []}');
	});

	test("records tool usage in stats", () => {
		const { getStatsDb } = require("../../db/index");

		captureResult({
			tool: "reviewCode",
			input: { diff: "test" },
			output: "result",
			durationMs: 250,
			mainaDir: tmpDir,
		});

		const dbResult = getStatsDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;

		const { db } = dbResult.value;
		const rows = db.query("SELECT * FROM tool_usage").all() as Array<{
			tool: string;
			duration_ms: number;
			cache_hit: number;
		}>;
		expect(rows).toHaveLength(1);
		expect(rows[0].tool).toBe("reviewCode");
		expect(rows[0].duration_ms).toBe(250);
		expect(rows[0].cache_hit).toBe(0);
	});

	test("does not throw on any failure", () => {
		// Invalid mainaDir — should silently fail
		expect(() => {
			captureResult({
				tool: "reviewCode",
				input: { diff: "test" },
				output: "result",
				durationMs: 100,
				mainaDir: "/nonexistent/path/that/should/not/exist",
			});
		}).not.toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/feedback/__tests__/capture.test.ts`
Expected: FAIL — module `../capture` not found

- [ ] **Step 3: Implement capture.ts**

```typescript
// packages/core/src/feedback/capture.ts
/**
 * MCP result capture — connects tool outputs to cache, feedback, and stats.
 * This is the core of the round-trip flywheel.
 */

import { hashContent } from "../cache/keys";
import { createCacheManager } from "../cache/manager";
import { trackToolUsage } from "../stats/tracker";
import { getWorkflowId, recordFeedback } from "./collector";

export interface CaptureInput {
	tool: string;
	input: Record<string, unknown>;
	output: string;
	promptHash?: string;
	durationMs: number;
	mainaDir: string;
	workflowId?: string;
}

/**
 * Build a deterministic cache key for an MCP tool call.
 * Content-addressed: same tool + same input → same key.
 */
export function buildToolCacheKey(
	tool: string,
	input: Record<string, unknown>,
): string {
	const inputHash = hashContent(JSON.stringify(input));
	return hashContent(`mcp:${tool}:${inputHash}`);
}

/**
 * Check cache for a previous result with the same tool + input.
 * Returns the cached output string or null on miss.
 * Tracks cache hits in the stats database.
 */
export function getCachedResult(
	tool: string,
	input: Record<string, unknown>,
	mainaDir: string,
): string | null {
	try {
		const cache = createCacheManager(mainaDir);
		const key = buildToolCacheKey(tool, input);
		const entry = cache.get(key);
		if (entry !== null) {
			const inputHash = hashContent(JSON.stringify(input));
			trackToolUsage(mainaDir, {
				tool,
				inputHash,
				durationMs: 0,
				cacheHit: true,
			});
			return entry.value;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Capture an MCP tool result: cache it, record feedback, track usage.
 * Cache write is synchronous (fast SQLite). Feedback is fire-and-forget.
 * Never throws.
 */
export function captureResult(input: CaptureInput): void {
	const inputHash = hashContent(JSON.stringify(input.input));

	// 1. Cache (synchronous — fast SQLite write)
	try {
		const cache = createCacheManager(input.mainaDir);
		const key = buildToolCacheKey(input.tool, input.input);
		cache.set(key, input.output, { ttl: 0 }); // content-addressed, never expires
	} catch {
		// Cache failure is non-fatal
	}

	// 2. Feedback (fire-and-forget via microtask)
	queueMicrotask(() => {
		try {
			recordFeedback(input.mainaDir, {
				promptHash: input.promptHash ?? `${input.tool}-mcp`,
				task: input.tool,
				accepted: true,
				timestamp: new Date().toISOString(),
			});
		} catch {
			// Never throw from background feedback
		}
	});

	// 3. Stats (synchronous — fast SQLite write)
	try {
		trackToolUsage(input.mainaDir, {
			tool: input.tool,
			inputHash,
			durationMs: input.durationMs,
			cacheHit: false,
			workflowId: input.workflowId,
		});
	} catch {
		// Stats failure is non-fatal
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/feedback/__tests__/capture.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/feedback/capture.ts packages/core/src/feedback/__tests__/capture.test.ts
git commit -m "feat(core): add captureResult and getCachedResult for MCP flywheel"
```

---

### Task 3: Create signals.ts — Implicit Accept/Reject

**Files:**
- Create: `packages/core/src/feedback/signals.ts`
- Create: `packages/core/src/feedback/__tests__/signals.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/feedback/__tests__/signals.test.ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getFeedbackDb } from "../../db/index";
import { recordFeedback } from "../collector";
import { emitAcceptSignal, emitRejectSignal } from "../signals";

let tmpDir: string;

beforeEach(() => {
	tmpDir = join(
		import.meta.dir,
		`tmp-signals-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

/** Insert a feedback row and set its workflow_id. */
function insertFeedback(
	tool: string,
	workflowId: string,
	accepted: boolean,
): void {
	recordFeedback(tmpDir, {
		promptHash: `${tool}-mcp`,
		task: tool,
		accepted,
		timestamp: new Date().toISOString(),
	});
	const dbResult = getFeedbackDb(tmpDir);
	if (!dbResult.ok) return;
	const { db } = dbResult.value;
	db.prepare(
		`UPDATE feedback SET workflow_id = ?
		 WHERE id = (SELECT id FROM feedback ORDER BY created_at DESC LIMIT 1)`,
	).run(workflowId);
}

describe("emitAcceptSignal", () => {
	test("marks recent review/verify entries as accepted", () => {
		insertFeedback("reviewCode", "wf-1", false);
		insertFeedback("verify", "wf-1", false);

		emitAcceptSignal(tmpDir, "wf-1");

		const dbResult = getFeedbackDb(tmpDir);
		expect(dbResult.ok).toBe(true);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		const rows = db
			.query(
				"SELECT command, accepted FROM feedback WHERE workflow_id = ?",
			)
			.all("wf-1") as Array<{ command: string; accepted: number }>;

		for (const row of rows) {
			expect(row.accepted).toBe(1);
		}
	});

	test("does not affect entries from a different workflow", () => {
		insertFeedback("reviewCode", "wf-1", false);
		insertFeedback("reviewCode", "wf-2", false);

		emitAcceptSignal(tmpDir, "wf-1");

		const dbResult = getFeedbackDb(tmpDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		const wf2 = db
			.query("SELECT accepted FROM feedback WHERE workflow_id = ?")
			.get("wf-2") as { accepted: number } | null;
		expect(wf2?.accepted).toBe(0);
	});

	test("accepts custom tool list", () => {
		insertFeedback("reviewCode", "wf-1", false);
		insertFeedback("verify", "wf-1", false);

		// Only accept reviewCode
		emitAcceptSignal(tmpDir, "wf-1", ["reviewCode"]);

		const dbResult = getFeedbackDb(tmpDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		const review = db
			.query(
				"SELECT accepted FROM feedback WHERE command = ? AND workflow_id = ?",
			)
			.get("reviewCode", "wf-1") as { accepted: number } | null;
		expect(review?.accepted).toBe(1);

		const verify = db
			.query(
				"SELECT accepted FROM feedback WHERE command = ? AND workflow_id = ?",
			)
			.get("verify", "wf-1") as { accepted: number } | null;
		expect(verify?.accepted).toBe(0);
	});
});

describe("emitRejectSignal", () => {
	test("marks the most recent entry for a tool+workflow as rejected", () => {
		insertFeedback("reviewCode", "wf-1", true);

		emitRejectSignal(tmpDir, "reviewCode", "wf-1");

		const dbResult = getFeedbackDb(tmpDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		const row = db
			.query(
				"SELECT accepted FROM feedback WHERE command = ? AND workflow_id = ? ORDER BY created_at DESC LIMIT 1",
			)
			.get("reviewCode", "wf-1") as { accepted: number } | null;
		expect(row?.accepted).toBe(0);
	});

	test("only rejects the most recent entry, not older ones", () => {
		insertFeedback("reviewCode", "wf-1", true);
		// Small delay to ensure different timestamps
		insertFeedback("reviewCode", "wf-1", true);

		emitRejectSignal(tmpDir, "reviewCode", "wf-1");

		const dbResult = getFeedbackDb(tmpDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		const rows = db
			.query(
				"SELECT accepted FROM feedback WHERE command = ? AND workflow_id = ? ORDER BY created_at ASC",
			)
			.all("reviewCode", "wf-1") as Array<{ accepted: number }>;

		expect(rows).toHaveLength(2);
		expect(rows[0].accepted).toBe(1); // older entry untouched
		expect(rows[1].accepted).toBe(0); // most recent rejected
	});

	test("does not throw when no matching entries exist", () => {
		expect(() => {
			emitRejectSignal(tmpDir, "reviewCode", "nonexistent");
		}).not.toThrow();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/feedback/__tests__/signals.test.ts`
Expected: FAIL — module `../signals` not found

- [ ] **Step 3: Implement signals.ts**

```typescript
// packages/core/src/feedback/signals.ts
/**
 * Implicit accept/reject signals for the RL flywheel.
 * Infers outcomes from downstream user behavior instead of requiring explicit action.
 */

import { getFeedbackDb } from "../db/index";

const DEFAULT_ACCEPT_TOOLS = ["reviewCode", "verify", "checkSlop"];

/**
 * Emit accept signal — called when maina commit succeeds.
 * Marks recent feedback entries for review/verify/slop tools
 * on this workflow as accepted.
 */
export function emitAcceptSignal(
	mainaDir: string,
	workflowId: string,
	tools?: string[],
): void {
	try {
		const dbResult = getFeedbackDb(mainaDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		const targetTools = tools ?? DEFAULT_ACCEPT_TOOLS;
		const placeholders = targetTools.map(() => "?").join(",");

		db.prepare(
			`UPDATE feedback SET accepted = 1
			 WHERE workflow_id = ?
			 AND command IN (${placeholders})`,
		).run(workflowId, ...targetTools);
	} catch {
		// Never throw from signals
	}
}

/**
 * Emit reject signal — marks the most recent feedback entry
 * for a tool+workflow as rejected.
 * Called when a tool is re-run (implying the previous result was not useful).
 */
export function emitRejectSignal(
	mainaDir: string,
	tool: string,
	workflowId: string,
): void {
	try {
		const dbResult = getFeedbackDb(mainaDir);
		if (!dbResult.ok) return;
		const { db } = dbResult.value;

		db.prepare(
			`UPDATE feedback SET accepted = 0
			 WHERE command = ? AND workflow_id = ?
			 AND id = (
				 SELECT id FROM feedback
				 WHERE command = ? AND workflow_id = ?
				 ORDER BY created_at DESC LIMIT 1
			 )`,
		).run(tool, workflowId, tool, workflowId);
	} catch {
		// Never throw from signals
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/feedback/__tests__/signals.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/feedback/signals.ts packages/core/src/feedback/__tests__/signals.test.ts
git commit -m "feat(core): add implicit accept/reject signals for RL flywheel"
```

---

### Task 4: Wire MCP Tool Handlers with Capture

**Files:**
- Modify: `packages/mcp/src/tools/review.ts`
- Modify: `packages/mcp/src/tools/verify.ts`
- Modify: `packages/mcp/src/tools/context.ts`
- Modify: `packages/mcp/src/tools/features.ts`
- Modify: `packages/mcp/src/tools/explain.ts`

Each handler gets:
- `reviewCode` only: cache check via `getCachedResult` at the start (its input contains actual diff content, making it safely content-addressable)
- All handlers: `captureResult` call after successful execution
- `reviewCode`: remove existing `recordFeedbackAsync` call (replaced by `captureResult`)

- [ ] **Step 1: Modify review.ts — add cache check + captureResult, remove recordFeedbackAsync**

Replace `packages/mcp/src/tools/review.ts` entirely:

```typescript
/**
 * Review tools — two-stage PR review for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerReviewTools(server: McpServer): void {
	server.tool(
		"reviewCode",
		"Run two-stage review (spec compliance + code quality) on a diff. In host mode, returns AI prompts for the host to process.",
		{ diff: z.string(), planContent: z.string().optional() },
		async ({ diff, planContent }) => {
			try {
				const {
					runTwoStageReview,
					captureResult,
					getCachedResult,
					getCurrentBranch,
					getWorkflowId,
				} = await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");
				const input = { diff, planContent };

				// Check cache — same diff = same review
				const cached = getCachedResult("reviewCode", input, mainaDir);
				if (cached !== null) {
					return {
						content: [{ type: "text" as const, text: cached }],
					};
				}

				const start = Date.now();
				const result = await runTwoStageReview({
					diff,
					planContent,
					mainaDir,
				});
				const durationMs = Date.now() - start;

				// Check for delegation prompts
				const allFindings = [
					...result.stage1.findings,
					...(result.stage2?.findings ?? []),
				];
				const hasDelegation = allFindings.some(
					(f) =>
						typeof f.message === "string" &&
						(f.message.includes("AI review:") ||
							f.message.includes("[HOST_DELEGATION]")),
				);

				const resultJson = JSON.stringify(result, null, 2);

				// Capture for flywheel (skip delegation results — AI may be available next time)
				if (!hasDelegation) {
					let workflowId: string | undefined;
					try {
						const branch = await getCurrentBranch(process.cwd());
						workflowId = getWorkflowId(branch);
					} catch {
						/* outside git repo */
					}

					captureResult({
						tool: "reviewCode",
						input,
						output: resultJson,
						promptHash: "review-mcp",
						durationMs,
						mainaDir,
						workflowId,
					});
				}

				if (hasDelegation) {
					return {
						content: [
							{
								type: "text" as const,
								text: resultJson,
							},
							{
								type: "text" as const,
								text: "\n\n---\nNote: AI review was not available (no API key). The deterministic checks above are complete. For AI-powered review, analyze the diff above for: cross-function consistency, missing edge cases, dead branches, API contract violations, and spec compliance.",
							},
						],
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: resultJson,
						},
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
```

- [ ] **Step 2: Modify verify.ts — add captureResult to both handlers**

Replace `packages/mcp/src/tools/verify.ts` entirely:

```typescript
/**
 * Verify tools — runs verification pipeline and slop detection for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerVerifyTools(server: McpServer): void {
	server.tool(
		"verify",
		"Run verification pipeline on staged or specified files",
		{ files: z.array(z.string()).optional() },
		async ({ files }) => {
			try {
				const {
					runPipeline,
					getStagedFiles,
					captureResult,
					getCurrentBranch,
					getWorkflowId,
				} = await import("@mainahq/core");
				const cwd = process.cwd();
				const mainaDir = join(cwd, ".maina");
				const targetFiles = files ?? (await getStagedFiles(cwd));

				const start = Date.now();
				const result = await runPipeline({
					files: targetFiles,
					cwd,
					mainaDir,
				});
				const durationMs = Date.now() - start;

				const aiReviewTool = result.tools.find(
					(t) => t.tool === "ai-review",
				);
				const aiSkipped = aiReviewTool?.skipped ?? true;

				const resultJson = JSON.stringify(
					{
						passed: result.passed,
						findings: result.findings,
						...(!result.syntaxPassed && {
							syntaxErrors: result.syntaxErrors,
						}),
						duration: result.duration,
					},
					null,
					2,
				);

				// Capture for flywheel
				let workflowId: string | undefined;
				try {
					const branch = await getCurrentBranch(cwd);
					workflowId = getWorkflowId(branch);
				} catch {
					/* outside git repo */
				}

				captureResult({
					tool: "verify",
					input: { files: targetFiles },
					output: resultJson,
					promptHash: result.passed ? "verify-pass" : "verify-fail",
					durationMs,
					mainaDir,
					workflowId,
				});

				if (aiSkipped) {
					return {
						content: [
							{
								type: "text" as const,
								text: resultJson,
							},
							{
								type: "text" as const,
								text: "\n\n---\nNote: AI review was not available (no API key). The deterministic checks above are complete. For AI-powered review, analyze the changed files for: cross-function consistency, missing edge cases, dead branches, API contract violations, and spec compliance.",
							},
						],
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: resultJson,
						},
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"checkSlop",
		"Check code for AI-generated slop patterns",
		{ files: z.array(z.string()) },
		async ({ files }) => {
			try {
				const {
					detectSlop,
					createCacheManager,
					captureResult,
					getCurrentBranch,
					getWorkflowId,
				} = await import("@mainahq/core");
				const cwd = process.cwd();
				const mainaDir = join(cwd, ".maina");

				const start = Date.now();
				const cache = createCacheManager(mainaDir);
				const result = await detectSlop(files, { cwd, cache });
				const durationMs = Date.now() - start;

				const resultJson = JSON.stringify(result, null, 2);

				// Capture for flywheel
				let workflowId: string | undefined;
				try {
					const branch = await getCurrentBranch(cwd);
					workflowId = getWorkflowId(branch);
				} catch {
					/* outside git repo */
				}

				captureResult({
					tool: "checkSlop",
					input: { files },
					output: resultJson,
					durationMs,
					mainaDir,
					workflowId,
				});

				return {
					content: [
						{
							type: "text" as const,
							text: resultJson,
						},
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
```

- [ ] **Step 3: Modify context.ts — add captureResult**

Replace `packages/mcp/src/tools/context.ts` entirely:

```typescript
/**
 * Context tools — assembles codebase context and conventions for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const COMMANDS = [
	"commit",
	"verify",
	"context",
	"review",
	"plan",
	"explain",
	"design",
	"ticket",
	"analyze",
	"pr",
] as const;

export function registerContextTools(server: McpServer): void {
	server.tool(
		"getContext",
		"Get focused codebase context for a command",
		{ command: z.enum(COMMANDS) },
		async ({ command }) => {
			try {
				const { assembleContext, captureResult } =
					await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");

				const start = Date.now();
				const result = await assembleContext(command, {
					repoRoot: process.cwd(),
					mainaDir,
				});
				const durationMs = Date.now() - start;

				captureResult({
					tool: "getContext",
					input: { command },
					output: result.text,
					durationMs,
					mainaDir,
				});

				return {
					content: [{ type: "text" as const, text: result.text }],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"getConventions",
		"Get project constitution and conventions",
		{},
		async () => {
			try {
				const { buildSystemPrompt, captureResult } =
					await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");

				const start = Date.now();
				const built = await buildSystemPrompt("review", mainaDir, {});
				const durationMs = Date.now() - start;

				captureResult({
					tool: "getConventions",
					input: {},
					output: built.prompt,
					durationMs,
					mainaDir,
				});

				return {
					content: [{ type: "text" as const, text: built.prompt }],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
```

- [ ] **Step 4: Modify features.ts — add captureResult**

Replace `packages/mcp/src/tools/features.ts` entirely:

```typescript
/**
 * Feature tools — test stub generation and cross-artifact analysis for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerFeatureTools(server: McpServer): void {
	server.tool(
		"suggestTests",
		"Generate TDD test stubs from a plan.md file",
		{ planPath: z.string() },
		async ({ planPath }) => {
			try {
				const content = await Bun.file(planPath).text();
				const {
					generateTestStubs,
					generateSpecQuestions,
					captureResult,
				} = await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");

				const start = Date.now();
				const stubs = generateTestStubs(content, "feature");
				const questionsResult = await generateSpecQuestions(
					content,
					planPath.includes(".maina")
						? planPath.slice(
								0,
								planPath.indexOf(".maina") + ".maina".length,
							)
						: ".maina",
				);
				const durationMs = Date.now() - start;

				const parts: Array<{ type: "text"; text: string }> = [
					{ type: "text" as const, text: stubs },
				];

				if (
					questionsResult.ok &&
					questionsResult.value.length > 0
				) {
					parts.push({
						type: "text" as const,
						text: `\n\n## Clarifying Questions\n\nThe following ambiguities were detected in the plan. Consider resolving them before implementation:\n\n${JSON.stringify(questionsResult.value, null, 2)}`,
					});
				}

				const fullOutput = parts.map((p) => p.text).join("");
				captureResult({
					tool: "suggestTests",
					input: { planPath },
					output: fullOutput,
					durationMs,
					mainaDir,
				});

				return { content: parts };
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"analyzeFeature",
		"Check spec/plan/tasks consistency for a feature",
		{ featureDir: z.string() },
		async ({ featureDir }) => {
			try {
				const { analyze, captureResult } =
					await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");

				const start = Date.now();
				const result = analyze(featureDir);
				const durationMs = Date.now() - start;

				if (!result.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: `Error: ${result.error}`,
							},
						],
						isError: true,
					};
				}

				const resultJson = JSON.stringify(result.value, null, 2);
				captureResult({
					tool: "analyzeFeature",
					input: { featureDir },
					output: resultJson,
					durationMs,
					mainaDir,
				});

				return {
					content: [
						{
							type: "text" as const,
							text: resultJson,
						},
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
```

- [ ] **Step 5: Modify explain.ts — add captureResult**

Replace `packages/mcp/src/tools/explain.ts` entirely:

```typescript
/**
 * Explain tools — dependency diagrams and module summaries for MCP clients.
 */

import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerExplainTools(server: McpServer): void {
	server.tool(
		"explainModule",
		"Get Mermaid dependency diagram for a directory",
		{ scope: z.string().optional() },
		async ({ scope }) => {
			try {
				const { generateDependencyDiagram, captureResult } =
					await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");

				const start = Date.now();
				const diagram = generateDependencyDiagram(mainaDir, {
					scope,
				});
				const durationMs = Date.now() - start;

				const output = diagram.ok
					? diagram.value
					: "No dependency data";

				captureResult({
					tool: "explainModule",
					input: { scope },
					output,
					durationMs,
					mainaDir,
				});

				return {
					content: [
						{
							type: "text" as const,
							text: output,
						},
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Error: ${e instanceof Error ? e.message : String(e)}`,
						},
					],
					isError: true,
				};
			}
		},
	);
}
```

- [ ] **Step 6: Run existing MCP server tests**

Run: `bun test packages/mcp/src/__tests__/server.test.ts`
Expected: PASS — tool registration is unchanged

- [ ] **Step 7: Run full test suite**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add packages/mcp/src/tools/review.ts packages/mcp/src/tools/verify.ts packages/mcp/src/tools/context.ts packages/mcp/src/tools/features.ts packages/mcp/src/tools/explain.ts
git commit -m "feat(mcp): wire all tool handlers with captureResult for RL flywheel"
```

---

### Task 5: Wire Commit Command with Accept Signal

**Files:**
- Modify: `packages/cli/src/commands/commit.ts:1-19,451-475`

- [ ] **Step 1: Add emitAcceptSignal import**

In `packages/cli/src/commands/commit.ts`, add `emitAcceptSignal` to the import block from `@mainahq/core` (line 3):

```typescript
import {
	addEpisodicEntry,
	appendWorkflowStep,
	assembleContext,
	checkAIAvailability,
	emitAcceptSignal,
	getCurrentBranch,
	getDiff,
	getStagedFiles,
	getWorkflowId,
	type PipelineResult,
	recordFeedbackAsync,
	recordOutcome,
	recordSnapshot,
	runHooks,
	runPipeline,
	setVerificationResult,
} from "@mainahq/core";
```

- [ ] **Step 2: Add accept signal after recordOutcome**

In the success path (around lines 451-475), add `emitAcceptSignal` call after `recordOutcome` and after `workflowId` is computed. Restructure to compute `workflowId` earlier:

Replace lines 451-475 with:

```typescript
	// ── Step 9: Record success in feedback ────────────────────────────────────
	recordOutcome(mainaDir, "commit-gate", {
		accepted: true,
		command: "commit",
		context: `committed: ${message}`,
	});

	const commitBranch = await getCurrentBranch(cwd);
	const workflowId = getWorkflowId(commitBranch);

	// Emit accept signal — commit success confirms prior review/verify results
	emitAcceptSignal(mainaDir, workflowId);

	const toolCount = pipelineResult?.tools.length ?? 0;
	const findingsCount = pipelineResult?.findings.length ?? 0;
	appendWorkflowStep(
		mainaDir,
		"commit",
		`Verified: ${toolCount} tools, ${findingsCount} findings. Committed.`,
	);

	recordFeedbackAsync(mainaDir, {
		promptHash: "deterministic",
		task: "commit",
		accepted: true,
		timestamp: new Date().toISOString(),
		workflowStep: "commit",
		workflowId,
	});
```

- [ ] **Step 3: Run existing commit tests (if any)**

Run: `bun test --filter commit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/commit.ts
git commit -m "feat(cli): emit accept signal on commit success for RL flywheel"
```

---

### Task 6: Export New Functions from Core

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add capture and signals exports**

After the existing feedback exports (line 165 area), add a new block:

```typescript
// Feedback — Capture & Signals (RL flywheel)
export {
	buildToolCacheKey,
	captureResult,
	type CaptureInput,
	getCachedResult,
} from "./feedback/capture";
export { emitAcceptSignal, emitRejectSignal } from "./feedback/signals";
```

- [ ] **Step 2: Add tool usage exports to existing stats block**

Replace the stats export block (around line 282-296) with:

```typescript
// Stats
export {
	type CommitSnapshot,
	type ComparisonReport,
	getComparison,
	getLatest,
	getSkipRate,
	getStats,
	getToolUsageStats,
	getTrends,
	recordSnapshot,
	type SnapshotInput,
	type StatsReport,
	type ToolUsageInput,
	type ToolUsageStats,
	trackToolUsage,
	type TrendDirection,
	type TrendsReport,
} from "./stats/tracker";
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Run full verification**

Run: `bun run verify`
Expected: All checks pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export captureResult, signals, and tool usage stats"
```
