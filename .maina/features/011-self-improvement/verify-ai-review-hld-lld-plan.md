# AI Verify Review + HLD/LLD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tiered AI review to the verify pipeline (mechanical always-on + standard via `--deep`) and generate HLD/LLD sections in `maina design`.

**Architecture:** Two independent features sharing the prompt engine and `tryAIGenerate()`. AI review is a new pipeline step that runs after diff filter and produces `Finding[]`. HLD/LLD extends the existing ADR scaffold with AI-generated content from spec.md.

**Tech Stack:** Bun, TypeScript, bun:test, Vercel AI SDK via `tryAIGenerate()`, tree-sitter (existing `parseFile()`), existing `Finding` interface from `diff-filter.ts`, existing cache via `buildCacheKey()`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/core/src/verify/ai-review.ts` | **NEW** — AI review module: builds context (diff + referenced functions), calls AI, parses findings |
| `packages/core/src/verify/__tests__/ai-review.test.ts` | **NEW** — Unit tests for AI review |
| `packages/core/src/verify/pipeline.ts` | Wire AI review as step 7b (after noisy rules filter), add `deep` option |
| `packages/core/src/verify/__tests__/pipeline.test.ts` | Add tests for AI review integration + `deep` flag |
| `packages/core/src/prompts/defaults/ai-review.md` | **NEW** — Prompt template for AI review |
| `packages/core/src/prompts/defaults/index.ts` | Add `"ai-review"` to `PromptTask` union |
| `packages/core/src/ai/tiers.ts` | Register `"code-review"` in `MECHANICAL_TASKS` |
| `packages/core/src/index.ts` | Export new public API |
| `packages/cli/src/commands/verify.ts` | Add `--deep` flag, pass to pipeline |
| `packages/core/src/design/index.ts` | Enhanced MADR template with HLD/LLD sections, AI generation |
| `packages/core/src/design/__tests__/design.test.ts` | Tests for enhanced template + AI generation |
| `packages/core/src/design/review.ts` | Validate HLD/LLD section presence |
| `packages/core/src/design/__tests__/review.test.ts` | Tests for HLD/LLD validation |
| `packages/core/src/prompts/defaults/design-hld-lld.md` | **NEW** — HLD/LLD generation prompt template |
| `packages/cli/src/commands/design.ts` | Wire `--hld` flag for AI HLD/LLD generation |

---

## Part 1: AI Verify Review

### Task 1: Register AI review task in model tiers

**Files:**
- Modify: `packages/core/src/ai/tiers.ts:12`
- Test: `packages/core/src/ai/__tests__/ai.test.ts`

- [ ] **Step 1: Write failing test — `code-review` maps to mechanical tier**

In `packages/core/src/ai/__tests__/ai.test.ts`, add:

```typescript
it("should map code-review to mechanical tier", () => {
  const { getTaskTier } = require("../../ai/tiers");
  expect(getTaskTier("code-review")).toBe("mechanical");
});

it("should map deep-code-review to standard tier", () => {
  const { getTaskTier } = require("../../ai/tiers");
  expect(getTaskTier("deep-code-review")).toBe("standard");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --filter "code-review"`
Expected: FAIL — `code-review` returns `"standard"` (default), not `"mechanical"`

- [ ] **Step 3: Add `code-review` to MECHANICAL_TASKS**

In `packages/core/src/ai/tiers.ts`, change line 12:

```typescript
const MECHANICAL_TASKS = new Set(["commit", "tests", "slop", "compress", "code-review"]);
```

The `deep-code-review` task will fall through to the default `"standard"` tier, which is correct.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --filter "code-review"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core): register code-review task in mechanical tier"
```

---

### Task 2: Create AI review prompt template

**Files:**
- Create: `packages/core/src/prompts/defaults/ai-review.md`
- Modify: `packages/core/src/prompts/defaults/index.ts:3`

- [ ] **Step 1: Write the prompt template**

Create `packages/core/src/prompts/defaults/ai-review.md`:

```markdown
You are reviewing code changes for semantic issues that static analysis cannot catch.

## Constitution (non-negotiable)
{{constitution}}

## Review Mode
{{reviewMode}}

## Instructions

Analyze the diff and referenced function bodies below. Report ONLY issues that are:
1. Cross-function consistency violations (caller passes wrong args, mismatched types, wrong order)
2. Missing edge cases (null/undefined not handled, empty arrays, boundary values)
3. Dead branches (conditions that can never be true given the data flow)
4. API contract violations (return type doesn't match declared interface, missing required fields)

{{#if specContext}}
Also check:
5. Spec compliance — does the implementation match the requirements in the spec?
6. Architecture — does the structure follow the design described in the plan?
7. Test coverage gaps — are there untested paths in the changed code?
{{/if}}

Severity rules:
- mechanical mode: ALL findings are "warning" severity (never "error")
- deep mode: findings may be "warning" or "error"

Respond in this exact JSON format (no markdown fences, no extra text):
{"findings":[{"file":"path","line":42,"message":"description","severity":"warning","ruleId":"ai-review/cross-function"}]}

Valid ruleIds: ai-review/cross-function, ai-review/edge-case, ai-review/dead-code, ai-review/contract, ai-review/spec-compliance, ai-review/architecture, ai-review/coverage-gap

If no issues found: {"findings":[]}

## Diff
{{diff}}

## Referenced Functions
{{referencedFunctions}}

{{#if specContext}}
## Spec
{{specContext}}
{{/if}}

{{#if planContext}}
## Plan
{{planContext}}
{{/if}}
```

- [ ] **Step 2: Add `ai-review` to PromptTask union**

In `packages/core/src/prompts/defaults/index.ts`, update the type:

```typescript
export type PromptTask =
  | "review"
  | "commit"
  | "tests"
  | "fix"
  | "explain"
  | "design"
  | "context"
  | "spec-questions"
  | "design-approaches"
  | "ai-review"
  | "design-hld-lld";
```

- [ ] **Step 3: Verify template loads**

Run: `bun -e "const { loadDefault } = require('./packages/core/src/prompts/defaults/index'); loadDefault('ai-review').then(t => console.log(t ? 'OK' : 'FAIL'))"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core): add ai-review prompt template"
```

---

### Task 3: Build AI review module — referenced function resolution

**Files:**
- Create: `packages/core/src/verify/ai-review.ts`
- Create: `packages/core/src/verify/__tests__/ai-review.test.ts`

- [ ] **Step 1: Write failing test — `resolveReferencedFunctions` extracts called functions from diff**

Create `packages/core/src/verify/__tests__/ai-review.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { resolveReferencedFunctions } from "../ai-review";

describe("resolveReferencedFunctions", () => {
  it("should extract function calls from added lines in diff", () => {
    const diff = `--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,5 @@ function existing() {
+  const result = validateInput(data);
+  processResult(result);
   return true;`;

    const entities = [
      { name: "validateInput", kind: "function" as const, startLine: 1, endLine: 5, filePath: "src/utils.ts",
        body: "function validateInput(data: unknown) {\n  if (!data) return null;\n  return data;\n}" },
      { name: "processResult", kind: "function" as const, startLine: 10, endLine: 15, filePath: "src/utils.ts",
        body: "function processResult(result: unknown) {\n  console.log(result);\n}" },
      { name: "unusedFunction", kind: "function" as const, startLine: 20, endLine: 25, filePath: "src/other.ts",
        body: "function unusedFunction() { return 1; }" },
    ];

    const result = resolveReferencedFunctions(diff, entities);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("validateInput");
    expect(result[1].name).toBe("processResult");
  });

  it("should cap at 3 referenced functions per file", () => {
    const diff = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,7 @@
+  fn1();
+  fn2();
+  fn3();
+  fn4();`;

    const entities = [
      { name: "fn1", kind: "function" as const, startLine: 1, endLine: 3, filePath: "src/a.ts", body: "function fn1() {}" },
      { name: "fn2", kind: "function" as const, startLine: 1, endLine: 3, filePath: "src/b.ts", body: "function fn2() {}" },
      { name: "fn3", kind: "function" as const, startLine: 1, endLine: 3, filePath: "src/c.ts", body: "function fn3() {}" },
      { name: "fn4", kind: "function" as const, startLine: 1, endLine: 3, filePath: "src/d.ts", body: "function fn4() {}" },
    ];

    const result = resolveReferencedFunctions(diff, entities);
    expect(result).toHaveLength(3);
  });

  it("should return empty array when no functions match", () => {
    const diff = `+++ b/src/app.ts
@@ -1,1 +1,2 @@
+  const x = 42;`;

    const result = resolveReferencedFunctions(diff, []);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --filter "resolveReferencedFunctions"`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement `resolveReferencedFunctions`**

Create `packages/core/src/verify/ai-review.ts`:

```typescript
/**
 * AI Review — semantic code review using LLM.
 *
 * Two tiers:
 * - mechanical (always-on): diff + referenced functions, <3s, warnings only
 * - standard (--deep): adds spec/plan context, can emit errors
 */

import type { Finding } from "./diff-filter";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ReferencedFunction {
  name: string;
  filePath: string;
  body: string;
}

export interface EntityWithBody {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  filePath: string;
  body: string;
}

export interface AIReviewOptions {
  diff: string;
  entities: EntityWithBody[];
  deep?: boolean;
  specContext?: string;
  planContext?: string;
  mainaDir: string;
}

export interface AIReviewResult {
  findings: Finding[];
  skipped: boolean;
  tier: "mechanical" | "standard";
  duration: number;
}

const MAX_REFS_PER_FILE = 3;

// ─── Referenced Function Resolution ───────────────────────────────────────

/**
 * Extract function/method names called in added lines of a diff,
 * then match them against known entities to get their bodies.
 * Capped at MAX_REFS_PER_FILE (3) to bound token usage.
 */
export function resolveReferencedFunctions(
  diff: string,
  entities: EntityWithBody[],
): ReferencedFunction[] {
  // Extract added lines from diff
  const addedLines = diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n");

  if (!addedLines.trim()) return [];

  // Extract identifier-like tokens that could be function calls
  // Match word( pattern — likely a function call
  const callPattern = /\b([a-zA-Z_$][\w$]*)\s*\(/g;
  const calledNames = new Set<string>();
  for (const match of addedLines.matchAll(callPattern)) {
    if (match[1]) calledNames.add(match[1]);
  }

  // Remove common keywords that match the pattern
  const KEYWORDS = new Set([
    "if", "for", "while", "switch", "catch", "function", "return",
    "new", "typeof", "instanceof", "await", "async", "import", "export",
    "const", "let", "var", "class", "throw",
  ]);
  for (const kw of KEYWORDS) calledNames.delete(kw);

  if (calledNames.size === 0) return [];

  // Match against known entities
  const matched: ReferencedFunction[] = [];
  for (const entity of entities) {
    if (matched.length >= MAX_REFS_PER_FILE) break;
    if (calledNames.has(entity.name)) {
      matched.push({
        name: entity.name,
        filePath: entity.filePath,
        body: entity.body,
      });
    }
  }

  return matched;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --filter "resolveReferencedFunctions"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core): add referenced function resolution for AI review"
```

---

### Task 4: Build AI review module — `runAIReview` with AI call and parsing

**Files:**
- Modify: `packages/core/src/verify/ai-review.ts`
- Modify: `packages/core/src/verify/__tests__/ai-review.test.ts`

- [ ] **Step 1: Write failing tests for `runAIReview`**

Append to `packages/core/src/verify/__tests__/ai-review.test.ts`:

```typescript
import { afterAll, beforeEach, mock } from "bun:test";
import { runAIReview, type AIReviewOptions } from "../ai-review";

// Mock tryAIGenerate
let mockAIResult: { text: string | null; fromAI: boolean; hostDelegation: boolean } = {
  text: null, fromAI: false, hostDelegation: false,
};

mock.module("../../ai/try-generate", () => ({
  tryAIGenerate: async () => mockAIResult,
}));

mock.module("../../cache/keys", () => ({
  hashContent: (s: string) => `hash-${s.length}`,
  buildCacheKey: async () => "test-cache-key",
}));

afterAll(() => mock.restore());

describe("runAIReview", () => {
  const baseOptions: AIReviewOptions = {
    diff: "+  const x = validateInput(data);",
    entities: [],
    mainaDir: ".maina",
  };

  beforeEach(() => {
    mockAIResult = { text: null, fromAI: false, hostDelegation: false };
  });

  it("should return findings from AI response (mechanical tier)", async () => {
    mockAIResult = {
      text: JSON.stringify({
        findings: [{
          file: "src/app.ts",
          line: 10,
          message: "validateInput may return null but caller doesn't check",
          severity: "warning",
          ruleId: "ai-review/edge-case",
        }],
      }),
      fromAI: true,
      hostDelegation: false,
    };

    const result = await runAIReview(baseOptions);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].tool).toBe("ai-review");
    expect(result.findings[0].severity).toBe("warning");
    expect(result.tier).toBe("mechanical");
    expect(result.skipped).toBe(false);
  });

  it("should cap severity to warning in mechanical mode", async () => {
    mockAIResult = {
      text: JSON.stringify({
        findings: [{
          file: "src/app.ts", line: 5,
          message: "bad", severity: "error",
          ruleId: "ai-review/contract",
        }],
      }),
      fromAI: true,
      hostDelegation: false,
    };

    const result = await runAIReview(baseOptions);

    expect(result.findings[0].severity).toBe("warning");
  });

  it("should allow error severity in deep mode", async () => {
    mockAIResult = {
      text: JSON.stringify({
        findings: [{
          file: "src/app.ts", line: 5,
          message: "spec violation", severity: "error",
          ruleId: "ai-review/spec-compliance",
        }],
      }),
      fromAI: true,
      hostDelegation: false,
    };

    const result = await runAIReview({ ...baseOptions, deep: true });

    expect(result.findings[0].severity).toBe("error");
    expect(result.tier).toBe("standard");
  });

  it("should skip gracefully when AI is unavailable", async () => {
    mockAIResult = { text: null, fromAI: false, hostDelegation: false };

    const result = await runAIReview(baseOptions);

    expect(result.findings).toHaveLength(0);
    expect(result.skipped).toBe(true);
  });

  it("should skip gracefully on malformed AI response", async () => {
    mockAIResult = { text: "not json", fromAI: true, hostDelegation: false };

    const result = await runAIReview(baseOptions);

    expect(result.findings).toHaveLength(0);
    expect(result.skipped).toBe(true);
  });

  it("should handle host delegation by skipping", async () => {
    mockAIResult = {
      text: "[HOST_DELEGATION] prompt here",
      fromAI: false,
      hostDelegation: true,
    };

    const result = await runAIReview(baseOptions);

    expect(result.skipped).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --filter "runAIReview"`
Expected: FAIL — `runAIReview` not exported

- [ ] **Step 3: Implement `runAIReview`**

Add to `packages/core/src/verify/ai-review.ts`:

```typescript
import { tryAIGenerate } from "../ai/try-generate";
import { buildCacheKey, hashContent } from "../cache/keys";
import { createCacheManager, type CacheManager } from "../cache/manager";

// ─── AI Review Runner ─────────────────────────────────────────────────────

const VALID_RULE_IDS = new Set([
  "ai-review/cross-function",
  "ai-review/edge-case",
  "ai-review/dead-code",
  "ai-review/contract",
  "ai-review/spec-compliance",
  "ai-review/architecture",
  "ai-review/coverage-gap",
]);

/**
 * Parse the AI response JSON into Finding[].
 * Returns null on any parse failure — caller should treat as skip.
 */
function parseAIResponse(text: string, deep: boolean): Finding[] | null {
  try {
    // Strip markdown fences if present
    const cleaned = text.replace(/^```json?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed || !Array.isArray(parsed.findings)) return null;

    const findings: Finding[] = [];
    for (const f of parsed.findings) {
      if (!f.file || typeof f.line !== "number" || !f.message) continue;

      let severity: Finding["severity"] = f.severity === "error" ? "error" : "warning";
      // Mechanical mode caps at warning
      if (!deep && severity === "error") severity = "warning";

      const ruleId = VALID_RULE_IDS.has(f.ruleId) ? f.ruleId : "ai-review/edge-case";

      findings.push({
        tool: "ai-review",
        file: f.file,
        line: f.line,
        message: f.message,
        severity,
        ruleId,
      });
    }

    return findings;
  } catch {
    return null;
  }
}

/**
 * Run AI review on a diff.
 *
 * - mechanical (default): uses "code-review" task → mechanical tier model, caps at warning
 * - standard (deep=true): uses "deep-code-review" task → standard tier model, can emit error
 *
 * Gracefully skips on AI failure, host delegation, or malformed response.
 */
export async function runAIReview(options: AIReviewOptions): Promise<AIReviewResult> {
  const start = performance.now();
  const { diff, entities, deep = false, specContext, planContext, mainaDir } = options;

  if (!diff.trim()) {
    return { findings: [], skipped: true, tier: deep ? "standard" : "mechanical", duration: 0 };
  }

  // Resolve referenced functions from entities
  const refs = resolveReferencedFunctions(diff, entities);
  const refsText = refs.length > 0
    ? refs.map((r) => `### ${r.name} (${r.filePath})\n\`\`\`typescript\n${r.body}\n\`\`\``).join("\n\n")
    : "None found.";

  const task = deep ? "deep-code-review" : "code-review";
  const reviewMode = deep
    ? "deep — check everything including spec compliance. May emit error severity."
    : "mechanical — check cross-function consistency and edge cases only. All findings are warning severity.";

  // ── Cache check ──────────────────────────────────────────────────────
  const cacheKey = await buildCacheKey({
    task,
    extra: hashContent(diff + refsText),
  });

  const cache = createCacheManager(mainaDir);
  const cached = cache.get<Finding[]>(cacheKey);
  if (cached) {
    const duration = Math.round(performance.now() - start);
    return { findings: cached, skipped: false, tier: deep ? "standard" : "mechanical", duration };
  }

  // ── AI call ──────────────────────────────────────────────────────────
  const variables: Record<string, string> = {
    diff,
    referencedFunctions: refsText,
    reviewMode,
  };

  if (deep && specContext) variables.specContext = specContext;
  if (deep && planContext) variables.planContext = planContext;

  const userPrompt = `Review this diff for semantic issues:\n\n${diff}`;

  const aiResult = await tryAIGenerate(task, mainaDir, variables, userPrompt);

  const duration = Math.round(performance.now() - start);
  const tier = deep ? "standard" : "mechanical";

  // Host delegation or no AI → skip (no cache entry per spec)
  if (!aiResult.text || aiResult.hostDelegation) {
    return { findings: [], skipped: true, tier, duration };
  }

  // Parse response
  const findings = parseAIResponse(aiResult.text, deep);
  if (findings === null) {
    return { findings: [], skipped: true, tier, duration };
  }

  // Cache successful result
  cache.set(cacheKey, findings);

  return { findings, skipped: false, tier, duration };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --filter "runAIReview"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core): implement runAIReview with mechanical + deep tiers"
```

---

### Task 5: Wire AI review into verify pipeline

**Files:**
- Modify: `packages/core/src/verify/pipeline.ts`
- Modify: `packages/core/src/verify/__tests__/pipeline.test.ts`

- [ ] **Step 1: Write failing tests for AI review in pipeline**

Add to `packages/core/src/verify/__tests__/pipeline.test.ts`:

Add mock state at the top (alongside existing mocks):

```typescript
import type { AIReviewResult } from "../ai-review";

let mockAIReviewResult: AIReviewResult = {
  findings: [], skipped: true, tier: "mechanical", duration: 0,
};

mock.module("../ai-review", () => ({
  runAIReview: async (..._args: unknown[]) => {
    callOrder.push("runAIReview");
    return mockAIReviewResult;
  },
}));
```

Add to `beforeEach`:

```typescript
mockAIReviewResult = { findings: [], skipped: true, tier: "mechanical", duration: 0 };
```

Add tests:

```typescript
it("should run AI review after diff filter and include findings", async () => {
  const aiReviewFinding = makeFinding({
    tool: "ai-review",
    message: "missing null check",
    severity: "warning",
    ruleId: "ai-review/edge-case",
  });

  mockAIReviewResult = {
    findings: [aiReviewFinding],
    skipped: false,
    tier: "mechanical",
    duration: 100,
  };

  const result = await runPipeline({ files: ["src/app.ts"] });

  expect(callOrder).toContain("runAIReview");
  expect(result.findings).toContainEqual(aiReviewFinding);
  expect(result.tools.find((t) => t.tool === "ai-review")).toBeDefined();
});

it("should pass deep flag to AI review when specified", async () => {
  const result = await runPipeline({ files: ["src/app.ts"], deep: true });

  expect(callOrder).toContain("runAIReview");
});

it("should pass when AI review is skipped", async () => {
  mockAIReviewResult = { findings: [], skipped: true, tier: "mechanical", duration: 0 };

  const result = await runPipeline({ files: ["src/app.ts"] });

  expect(result.passed).toBe(true);
  const aiReport = result.tools.find((t) => t.tool === "ai-review");
  expect(aiReport?.skipped).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --filter "pipeline" packages/core/src/verify/__tests__/pipeline.test.ts`
Expected: FAIL — `deep` not in PipelineOptions, AI review not wired

- [ ] **Step 3: Wire AI review into pipeline**

In `packages/core/src/verify/pipeline.ts`:

Add import:

```typescript
import { runAIReview, type AIReviewResult } from "./ai-review";
```

Update `PipelineOptions`:

```typescript
export interface PipelineOptions {
  files?: string[];
  baseBranch?: string;
  diffOnly?: boolean;
  deep?: boolean;        // NEW — triggers standard-tier AI review
  cwd?: string;
  mainaDir?: string;
}
```

After step 6b (noisy rules filter, around line 239), before step 7 (pass/fail), add:

```typescript
// ── Step 7: AI review (mechanical always, standard if --deep) ────────
const deep = options?.deep ?? false;

const aiReviewResult: AIReviewResult = await runAIReview({
  diff: diffOnly ? await getDiff(baseBranch, undefined, cwd) : "",
  entities: [], // Entities require tree-sitter + file body reads; wired when semantic index is hydrated (SC-1 of original plan)
  deep,
  mainaDir: options?.mainaDir ?? ".maina",
});

const aiReport: ToolReport = {
  tool: "ai-review",
  findings: aiReviewResult.findings,
  skipped: aiReviewResult.skipped,
  duration: aiReviewResult.duration,
};

toolReports.push(aiReport);

// Merge AI findings into shown findings
shownFindings.push(...aiReviewResult.findings);
```

Renumber step 7 (pass/fail) to step 8, step 8 (return) to step 9.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --filter "pipeline" packages/core/src/verify/__tests__/pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core): wire AI review into verify pipeline"
```

---

### Task 6: Add `--deep` flag to CLI verify command

**Files:**
- Modify: `packages/cli/src/commands/verify.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update `VerifyActionOptions` and wire `deep` flag**

In `packages/cli/src/commands/verify.ts`:

Add `deep?: boolean` to `VerifyActionOptions` interface.

In `verifyAction`, pass `deep` to pipeline options:

```typescript
const pipelineOpts: {
  files?: string[];
  baseBranch: string;
  diffOnly: boolean;
  deep: boolean;
  cwd: string;
  mainaDir: string;
} = {
  baseBranch,
  diffOnly: !options.all,
  deep: options.deep ?? false,
  cwd,
  mainaDir,
};
```

In `verifyCommand`, add option:

```typescript
.option("--deep", "Run standard-tier AI semantic review")
```

And wire it in the action:

```typescript
deep: options.deep,
```

- [ ] **Step 2: Export `AIReviewResult` and `AIReviewOptions` from core index**

In `packages/core/src/index.ts`, add:

```typescript
export {
  type AIReviewOptions,
  type AIReviewResult,
  resolveReferencedFunctions,
  runAIReview,
} from "./verify/ai-review";
```

- [ ] **Step 3: Run full verification**

Run: `bun run verify`
Expected: Pipeline runs with ai-review tool in output

- [ ] **Step 4: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(cli): add --deep flag to maina verify"
```

---

## Part 2: HLD/LLD in Design

### Task 7: Create HLD/LLD prompt template

**Files:**
- Create: `packages/core/src/prompts/defaults/design-hld-lld.md`

- [ ] **Step 1: Write the prompt template**

Create `packages/core/src/prompts/defaults/design-hld-lld.md`:

```markdown
You are generating High-Level Design (HLD) and Low-Level Design (LLD) sections for an Architecture Decision Record.

## Constitution (non-negotiable)
{{constitution}}

## Instructions

Given the spec below, generate HLD and LLD sections in markdown. Use concrete details from the spec — never invent requirements.

For any section where the spec does not provide enough information, write `[NEEDS CLARIFICATION]` instead of guessing.

Output ONLY the markdown sections below (no preamble, no fences):

## High-Level Design
### System Overview
(2-3 sentences describing what this change does at a system level)

### Component Boundaries
(List each component/module affected and its responsibility)

### Data Flow
(Describe how data moves through the components)

### External Dependencies
(List any new dependencies, APIs, or services)

## Low-Level Design
### Interfaces & Types
(TypeScript interfaces and types to be created or modified)

### Function Signatures
(Key function signatures with parameter and return types)

### DB Schema Changes
(Any database table or column changes, or "None")

### Sequence of Operations
(Step-by-step order of operations for the main flow)

### Error Handling
(How errors are handled at each step)

### Edge Cases
(Known edge cases and how they are addressed)

## Spec
{{spec}}

## Project Conventions
{{conventions}}

{{#if context}}
## Codebase Context
{{context}}
{{/if}}
```

- [ ] **Step 2: Verify template loads**

Run: `bun -e "const { loadDefault } = require('./packages/core/src/prompts/defaults/index'); loadDefault('design-hld-lld').then(t => console.log(t ? 'OK' : 'FAIL'))"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core): add design-hld-lld prompt template"
```

---

### Task 8: Enhance ADR template with HLD/LLD sections

**Files:**
- Modify: `packages/core/src/design/index.ts`
- Modify: `packages/core/src/design/__tests__/design.test.ts`

- [ ] **Step 1: Write failing test — scaffold includes HLD/LLD sections**

In `packages/core/src/design/__tests__/design.test.ts`, add:

```typescript
import { describe, expect, it } from "bun:test";
import { scaffoldAdr } from "../index";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("scaffoldAdr with HLD/LLD", () => {
  const testDir = join(import.meta.dir, "__fixtures__/adr-hld");

  it("should include HLD and LLD sections in scaffold", async () => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });

    const result = await scaffoldAdr(testDir, "0001", "Test Decision");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const content = readFileSync(result.value, "utf-8");

    // HLD sections
    expect(content).toContain("## High-Level Design");
    expect(content).toContain("### System Overview");
    expect(content).toContain("### Component Boundaries");
    expect(content).toContain("### Data Flow");
    expect(content).toContain("### External Dependencies");

    // LLD sections
    expect(content).toContain("## Low-Level Design");
    expect(content).toContain("### Interfaces & Types");
    expect(content).toContain("### Function Signatures");
    expect(content).toContain("### DB Schema Changes");
    expect(content).toContain("### Sequence of Operations");
    expect(content).toContain("### Error Handling");
    expect(content).toContain("### Edge Cases");

    // Cleanup
    rmSync(testDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --filter "HLD/LLD"`
Expected: FAIL — current template doesn't include HLD/LLD sections

- [ ] **Step 3: Update `buildMadrTemplate` in `design/index.ts`**

Replace the `buildMadrTemplate` function:

```typescript
function buildMadrTemplate(number: string, title: string): string {
  const today = new Date().toISOString().split("T")[0];
  return `# ${number}. ${title}

Date: ${today}

## Status

Proposed

## Context

What is the issue that we're seeing that is motivating this decision or change?

[NEEDS CLARIFICATION] Describe the context.

## Decision

What is the change that we're proposing and/or doing?

[NEEDS CLARIFICATION] Describe the decision.

## Consequences

What becomes easier or more difficult to do because of this change?

### Positive

- [NEEDS CLARIFICATION]

### Negative

- [NEEDS CLARIFICATION]

### Neutral

- [NEEDS CLARIFICATION]

## High-Level Design

### System Overview

[NEEDS CLARIFICATION]

### Component Boundaries

[NEEDS CLARIFICATION]

### Data Flow

[NEEDS CLARIFICATION]

### External Dependencies

[NEEDS CLARIFICATION]

## Low-Level Design

### Interfaces & Types

[NEEDS CLARIFICATION]

### Function Signatures

[NEEDS CLARIFICATION]

### DB Schema Changes

[NEEDS CLARIFICATION]

### Sequence of Operations

[NEEDS CLARIFICATION]

### Error Handling

[NEEDS CLARIFICATION]

### Edge Cases

[NEEDS CLARIFICATION]
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --filter "HLD/LLD"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core): enhance ADR template with HLD/LLD sections"
```

---

### Task 9: Add AI generation of HLD/LLD from spec

**Files:**
- Modify: `packages/core/src/design/index.ts`
- Modify: `packages/core/src/design/__tests__/design.test.ts`

- [ ] **Step 1: Write failing test — `generateHldLld` returns AI-generated content**

Add to `packages/core/src/design/__tests__/design.test.ts`:

```typescript
import { afterAll, beforeEach, mock } from "bun:test";
import { generateHldLld } from "../index";

let mockAIResult = { text: null as string | null, fromAI: false, hostDelegation: false };

mock.module("../../ai/try-generate", () => ({
  tryAIGenerate: async () => mockAIResult,
}));

afterAll(() => mock.restore());

describe("generateHldLld", () => {
  beforeEach(() => {
    mockAIResult = { text: null, fromAI: false, hostDelegation: false };
  });

  it("should return AI-generated HLD/LLD content when spec exists", async () => {
    const hldLldContent = `## High-Level Design

### System Overview
This adds AI review to the verify pipeline.

### Component Boundaries
- ai-review.ts: AI review logic

### Data Flow
Diff -> AI -> Findings

### External Dependencies
None

## Low-Level Design

### Interfaces & Types
AIReviewResult interface

### Function Signatures
runAIReview(options): Promise<AIReviewResult>

### DB Schema Changes
None

### Sequence of Operations
1. Get diff 2. Call AI

### Error Handling
Graceful skip on failure

### Edge Cases
Empty diff returns no findings`;

    mockAIResult = { text: hldLldContent, fromAI: true, hostDelegation: false };

    const result = await generateHldLld("Test spec content", ".maina");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toContain("## High-Level Design");
    expect(result.value).toContain("## Low-Level Design");
  });

  it("should return null when AI is unavailable", async () => {
    mockAIResult = { text: null, fromAI: false, hostDelegation: false };

    const result = await generateHldLld("Test spec", ".maina");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --filter "generateHldLld"`
Expected: FAIL — function not exported

- [ ] **Step 3: Implement `generateHldLld`**

Add to `packages/core/src/design/index.ts`:

```typescript
import { tryAIGenerate } from "../ai/try-generate";

/**
 * Generate HLD/LLD sections from a spec using AI (standard tier).
 * Returns the generated markdown content, or null if AI is unavailable.
 */
export async function generateHldLld(
  specContent: string,
  mainaDir: string,
): Promise<Result<string | null>> {
  try {
    const variables: Record<string, string> = {
      spec: specContent,
      conventions: "",
    };

    const aiResult = await tryAIGenerate(
      "design-hld-lld",
      mainaDir,
      variables,
      `Generate HLD and LLD sections for this spec:\n\n${specContent}`,
    );

    if (!aiResult.text || aiResult.hostDelegation) {
      return { ok: true, value: null };
    }

    return { ok: true, value: aiResult.text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `HLD/LLD generation failed: ${message}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --filter "generateHldLld"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core): add AI-powered HLD/LLD generation from spec"
```

---

### Task 10: Extend design review to validate HLD/LLD sections

**Files:**
- Modify: `packages/core/src/design/review.ts`
- Modify: `packages/core/src/design/__tests__/review.test.ts`

- [ ] **Step 1: Write failing tests for HLD/LLD validation**

Add to `packages/core/src/design/__tests__/review.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { reviewDesign, type ReviewContext } from "../review";

describe("reviewDesign HLD/LLD validation", () => {
  function makeContext(content: string): ReviewContext {
    return {
      targetAdr: { path: "/test/0001-test.md", content, title: "Test" },
      existingAdrs: [],
      constitution: null,
    };
  }

  it("should warn when HLD sections are missing", () => {
    const content = `# 0001. Test

## Status
Proposed

## Context
Some context.

## Decision
Some decision.

## Consequences
Some consequences.
`;

    const result = reviewDesign(makeContext(content));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const hldWarning = result.value.findings.find(
      (f) => f.message.includes("High-Level Design"),
    );
    expect(hldWarning).toBeDefined();
    expect(hldWarning?.severity).toBe("warning");
  });

  it("should warn when LLD sections are missing", () => {
    const content = `# 0001. Test

## Status
Proposed

## Context
Some context.

## Decision
Some decision.

## Consequences
Some consequences.

## High-Level Design
### System Overview
Overview here.
### Component Boundaries
Components here.
### Data Flow
Flow here.
### External Dependencies
None.
`;

    const result = reviewDesign(makeContext(content));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lldWarning = result.value.findings.find(
      (f) => f.message.includes("Low-Level Design"),
    );
    expect(lldWarning).toBeDefined();
  });

  it("should pass when all sections are present", () => {
    const content = `# 0001. Test

## Status
Proposed

## Context
Some context.

## Decision
Some decision.

## Consequences
Some consequences.

## High-Level Design
### System Overview
Overview.
### Component Boundaries
Components.
### Data Flow
Flow.
### External Dependencies
None.

## Low-Level Design
### Interfaces & Types
Types.
### Function Signatures
Signatures.
### DB Schema Changes
None.
### Sequence of Operations
Steps.
### Error Handling
Errors.
### Edge Cases
Edges.
`;

    const result = reviewDesign(makeContext(content));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const designWarnings = result.value.findings.filter(
      (f) => f.message.includes("Design"),
    );
    expect(designWarnings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --filter "HLD/LLD validation"`
Expected: FAIL — no HLD/LLD checks in reviewDesign

- [ ] **Step 3: Add HLD/LLD validation to `reviewDesign`**

In `packages/core/src/design/review.ts`:

Add constants:

```typescript
const HLD_SECTIONS = [
  "System Overview",
  "Component Boundaries",
  "Data Flow",
  "External Dependencies",
];

const LLD_SECTIONS = [
  "Interfaces & Types",
  "Function Signatures",
  "DB Schema Changes",
  "Sequence of Operations",
  "Error Handling",
  "Edge Cases",
];
```

In the `reviewDesign` function, after the `[NEEDS CLARIFICATION]` check, add:

```typescript
// Check HLD sections (warning, not error — these are optional for simple ADRs)
const hasHldHeader = /^##\s+High-Level Design/im.test(content);
if (!hasHldHeader) {
  findings.push({
    severity: "warning",
    message: "Missing High-Level Design section — consider adding for complex decisions",
    section: "High-Level Design",
  });
} else {
  for (const sub of HLD_SECTIONS) {
    const pattern = new RegExp(`^###\\s+${sub.replace(/[&]/g, "\\$&")}\\s*$`, "im");
    if (!pattern.test(content)) {
      findings.push({
        severity: "warning",
        message: `High-Level Design missing subsection: "${sub}"`,
        section: `High-Level Design / ${sub}`,
      });
    }
  }
}

// Check LLD sections
const hasLldHeader = /^##\s+Low-Level Design/im.test(content);
if (!hasLldHeader) {
  findings.push({
    severity: "warning",
    message: "Missing Low-Level Design section — consider adding for complex decisions",
    section: "Low-Level Design",
  });
} else {
  for (const sub of LLD_SECTIONS) {
    const pattern = new RegExp(`^###\\s+${sub.replace(/[&]/g, "\\$&")}\\s*$`, "im");
    if (!pattern.test(content)) {
      findings.push({
        severity: "warning",
        message: `Low-Level Design missing subsection: "${sub}"`,
        section: `Low-Level Design / ${sub}`,
      });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --filter "HLD/LLD validation"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core): add HLD/LLD section validation to design review"
```

---

### Task 11: Wire HLD/LLD generation into CLI design command

**Files:**
- Modify: `packages/cli/src/commands/design.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Export `generateHldLld` from core index**

In `packages/core/src/index.ts`, update the design exports:

```typescript
export {
  type AdrSummary,
  generateHldLld,
  getNextAdrNumber,
  listAdrs,
  scaffoldAdr,
} from "./design/index";
```

- [ ] **Step 2: Add `--hld` flag and wire AI generation**

In `packages/cli/src/commands/design.ts`:

Add `hld?: boolean` to `DesignActionOptions`.

In `designAction`, after scaffolding (step 3) and before approach proposals (step 4), add:

```typescript
// Step 3b: Generate HLD/LLD if --hld and spec exists
if (options.hld) {
  const mainaDir = join(cwd, ".maina");
  const featureDir = join(mainaDir, "features");

  // Find current feature spec
  let specContent: string | null = null;
  try {
    const { readdirSync, readFileSync } = await import("node:fs");
    const features = readdirSync(featureDir);
    // Find latest feature directory with a spec.md
    const sorted = features
      .filter((f) => /^\d{3}-/.test(f))
      .sort()
      .reverse();

    for (const dir of sorted) {
      const specPath = join(featureDir, dir, "spec.md");
      if (existsSync(specPath)) {
        specContent = readFileSync(specPath, "utf-8");
        break;
      }
    }
  } catch {
    // No feature spec found
  }

  if (specContent) {
    const { generateHldLld } = await import("@maina/core");
    log.info("Generating HLD/LLD from spec...");
    const hldResult = await generateHldLld(specContent, join(cwd, ".maina"));

    if (hldResult.ok && hldResult.value) {
      // Replace the HLD/LLD placeholder sections in the scaffolded ADR
      const { readFileSync, writeFileSync } = await import("node:fs");
      const adrContent = readFileSync(filePath, "utf-8");

      // Find where HLD section starts and replace everything from there to end
      const hldIndex = adrContent.indexOf("## High-Level Design");
      if (hldIndex !== -1) {
        const newContent = adrContent.slice(0, hldIndex) + hldResult.value + "\n";
        writeFileSync(filePath, newContent);
        log.success("HLD/LLD sections generated from spec.");
      }
    } else {
      log.warn("AI unavailable — HLD/LLD sections left as placeholders.");
    }
  } else {
    log.warn("No spec.md found — HLD/LLD sections left as placeholders.");
  }
}
```

In `designCommand`, add option:

```typescript
.option("--hld", "Generate HLD/LLD from feature spec using AI")
```

And wire it:

```typescript
hld: options.hld,
```

- [ ] **Step 3: Run full verification**

Run: `bun run verify`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(cli): wire --hld flag for AI HLD/LLD generation in maina design"
```

---

### Task 12: Full verification and integration test

**Files:**
- All modified files

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 2: Run biome check**

Run: `bun run check`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: All tests pass

- [ ] **Step 4: Run maina verify**

Run: `bun packages/cli/dist/index.js verify`
Expected: Pipeline passes, shows ai-review tool in output

- [ ] **Step 5: Run maina verify --deep**

Run: `bun packages/cli/dist/index.js verify --deep`
Expected: Pipeline runs with standard-tier AI review

- [ ] **Step 6: Commit final state**

```bash
bun packages/cli/dist/index.js commit -m "feat(core,cli): AI verify review + HLD/LLD in design — complete"
```
