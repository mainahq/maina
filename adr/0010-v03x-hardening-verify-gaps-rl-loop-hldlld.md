# 0010. v0.3.x Hardening: Verify Gaps + RL Loop + HLD/LLD

Date: 2026-04-05

## Status

Accepted

## Context

Tier 3 benchmark (2026-04-03): SpecKit achieved 100% on 95 hidden validation tests. Maina got 97.9% (2 bugs). SpecKit's 58s self-review caught 4 issues that Maina's verify pipeline missed because no external tools were installed. `maina verify` returned "0 findings, passed" — false confidence.

Additionally, `maina design` only produces ADR scaffolds with no HLD/LLD generation, `maina spec` and `maina design` lack `--auto` flags (blocking CI/benchmark automation), and the RL loop doesn't close automatically after workflow completion.

## Decision

Add built-in verification checks that work without external tools, AI-powered review via delegation protocol, HLD/LLD generation in design, automation flags, and automatic post-workflow RL trace analysis. Execute sequentially: deterministic checks first, then AI features, then automation.

## Consequences

### Positive

- `maina verify` produces meaningful findings on any project, even with 0 external tools installed
- AI self-review catches cross-function consistency bugs that deterministic tools miss
- `maina design` generates useful HLD/LLD from spec, not just empty templates
- `--auto` flags enable full workflow automation in CI and benchmarks
- RL loop closes automatically — prompts improve without human intervention

### Negative

- AI self-review adds latency (~3s mechanical, ~15s deep)
- Cross-function consistency check depends on tree-sitter AST quality per language
- Automatic RL could theoretically degrade prompts (mitigated by A/B testing with rollback)

### Neutral

- Built-in typecheck duplicates what external tools do, but guarantees baseline coverage
- HLD/LLD quality depends on spec quality — garbage in, garbage out

## High-Level Design

### System Overview

Four phases layered bottom-up:
1. **Phase 0** — Fix 43 test regressions (prerequisite)
2. **Phase 1** — Deterministic built-in checks: typecheck, consistency, 0-tools warning, Biome init
3. **Phase 2** — AI-powered: self-review in verify (mechanical + deep), HLD/LLD in design
4. **Phase 3** — Automation: --auto flags, post-workflow RL trace analysis

### Component Boundaries

```
verify/pipeline.ts ── orchestrates all tools
  ├── verify/typecheck.ts (NEW) ── runs tsc/mypy/go vet per language
  ├── verify/consistency.ts (NEW) ── AST cross-function checks
  ├── verify/ai-review.ts (MODIFY) ── add mechanical always-on tier
  ├── verify/detect.ts (MODIFY) ── 0-tools warning
  └── verify/slop.ts (existing)

design/index.ts (MODIFY) ── HLD/LLD generation from spec
init/index.ts (MODIFY) ── Biome auto-configuration
feedback/trace-analysis.ts (NEW) ── post-workflow RL
```

### Data Flow

```
git diff → pipeline.ts
  → typecheck.ts → Finding[]
  → consistency.ts → Finding[]
  → slop.ts → Finding[]
  → [external tools if available] → Finding[]
  → ai-review.ts (delegation protocol) → Finding[]
  → diff-filter → filtered Finding[]
  → PipelineResult
```

### External Dependencies

- `tsc` — ships with TypeScript (already a dev dependency in most TS projects)
- `mypy`, `go vet`, `dotnet build`, `javac` — language-native, expected on dev machines
- tree-sitter — already in stack (web-tree-sitter)
- AI delegation — uses existing `---MAINA_AI_REQUEST---` protocol, no new deps

## Low-Level Design

### Interfaces & Types

```typescript
// verify/typecheck.ts
export interface TypecheckResult {
  findings: Finding[];
  duration: number;
  tool: string; // "tsc", "mypy", "go-vet", etc.
}

// verify/consistency.ts
export interface ConsistencyRule {
  pattern: string;      // e.g., "isURL calls should pair with isIP"
  source: "spec" | "heuristic";
}

export interface ConsistencyResult {
  findings: Finding[];
  rulesChecked: number;
}

// feedback/trace-analysis.ts
export interface WorkflowTrace {
  workflowId: string;
  steps: TraceStep[];
  startedAt: string;
  completedAt: string;
}

export interface TraceStep {
  command: string;
  promptHash: string;
  context: string;
  output: string;
  accepted: boolean;
  modification?: string;
}

export interface PromptImprovement {
  promptFile: string;
  currentHash: string;
  suggestedChange: string;
  reason: string;
  confidence: number;
}
```

### Function Signatures

```typescript
// verify/typecheck.ts
export async function runTypecheck(files: string[], cwd: string): Promise<TypecheckResult>

// verify/consistency.ts
export async function checkConsistency(files: string[], cwd: string, mainaDir: string): Promise<ConsistencyResult>

// verify/ai-review.ts (existing, modify)
export async function runAIReview(diff: string, options: AIReviewOptions): Promise<Finding[]>
// Add: options.mechanical (boolean) — always-on tier

// feedback/trace-analysis.ts
export async function analyzeWorkflowTrace(mainaDir: string, workflowId: string): Promise<PromptImprovement[]>
export async function applyImprovements(mainaDir: string, improvements: PromptImprovement[]): Promise<void>
```

### DB Schema Changes

No new tables. Workflow traces already stored via `appendWorkflowStep()` in feedback collector. Trace analysis reads existing data.

### Sequence of Operations

**Verify pipeline (updated):**
1. Syntax guard (existing, <500ms)
2. Typecheck — `tsc --noEmit` parsed to Finding[] (NEW)
3. Consistency check — tree-sitter AST analysis (NEW)
4. Parallel external tools (existing)
5. Slop detection (existing)
6. AI self-review mechanical tier (MODIFIED — always-on)
7. AI self-review standard tier (existing — only with --deep)
8. Diff filter (existing)
9. Return PipelineResult

**Post-workflow RL (new):**
1. `maina pr` completes
2. Background: collect full trace from workflow context
3. Analyze: prompt effectiveness per step
4. Generate improvements
5. Auto-feed into `maina learn` (no human gate)

### Error Handling

- Typecheck binary not found → skip with info note, not error
- AI review fails → degrade to deterministic-only, never block
- Trace analysis fails → log warning, don't block PR creation
- Consistency check finds no spec → fall back to heuristic patterns
- All new checks use Result<T, E> pattern

### Edge Cases

- Project with no tsconfig.json → skip typecheck for TS, try other language tools
- Polyglot repo → run typecheck for each detected language
- Empty diff → skip all checks, return passed
- 0 external tools AND 0 built-in findings → still show "0 tools" warning
- AI delegation in non-host mode → use OpenRouter directly
- Spec with no constraints → consistency check uses heuristics only
