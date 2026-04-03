# Internal Stats Tracker

**Purpose:** Capture per-commit metrics (time, tokens, cache, quality) so we can verify maina is improving developer speed, cost, and code quality over time. Internal diagnostic — not a user-facing feature.

## Data Collection

After every successful `maina commit`, record one row to `.maina/stats.db`.

### Schema: `commit_snapshots`

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | UUID |
| timestamp | text | ISO 8601 |
| branch | text | Git branch name |
| commitHash | text | Short SHA |
| verifyDurationMs | integer | Verification pipeline wall-clock time |
| totalDurationMs | integer | Full commit cycle time (hooks + verify + commit) |
| contextTokens | integer | Tokens assembled by context engine |
| contextBudget | integer | Total token budget for the command |
| contextUtilization | real | contextTokens / contextBudget as decimal |
| cacheHits | integer | Cache hits during this commit cycle |
| cacheMisses | integer | Cache misses during this commit cycle |
| findingsTotal | integer | Total findings from all tools |
| findingsErrors | integer | Error-severity findings |
| findingsWarnings | integer | Warning-severity findings |
| toolsRun | integer | Number of verification tools executed |
| syntaxPassed | integer | 1 if syntax guard passed, 0 if not |
| pipelinePassed | integer | 1 if full pipeline passed, 0 if not |

### Collection point

Inside `commitAction()` in `packages/cli/src/commands/commit.ts`. After a successful git commit, call `recordSnapshot()` with data already available in scope:

- `pipelineResult` provides: duration, findings, tools, syntaxPassed, passed
- `assembleContext()` provides: tokens, budget (call context engine for commit's working layer)
- Cache stats from `createCacheManager().stats()`
- Branch and commit hash from git operations already performed

No additional computation needed — all data is already produced during the commit flow.

## Display: `maina stats`

### Default output (no flags)

```
maina stats — 13 commits tracked

  Last commit (64f0b3f):
    Verify: 7.7s | Tokens: 2487/200k (1.2%) | Cache: 0/0 | Findings: 0

  Rolling average (last 10):
    Verify: 8.4s | Tokens: 2300 | Cache hit: 0% | Findings: 1.2/commit

  Trends (vs previous 10):
    verify ↓12% | tokens ↑6% | cache → | quality ↑
```

Trends compare the most recent N commits against the previous N. Arrows: ↑ (increase >5%), ↓ (decrease >5%), → (stable within 5%).

### Flags

- `--json` — Output raw `CommitSnapshot[]` array as JSON to stdout
- `--last N` — Show stats for last N commits (default: 10)

### Trend calculation

For each metric, compare `avg(last N)` vs `avg(previous N)`:
- Verify duration: lower is better (↓ = improving)
- Context utilization: stable is good (→ = healthy)
- Cache hit rate: higher is better (↑ = improving)
- Findings per commit: lower is better (↓ = improving)

## Files

| File | Purpose |
|------|---------|
| `packages/core/src/stats/tracker.ts` | `recordSnapshot()`, `getStats()`, `getLatest()`, `getTrends()` |
| `packages/core/src/stats/__tests__/tracker.test.ts` | Tests for all tracker functions |
| `packages/cli/src/commands/stats.ts` | `maina stats` CLI command |
| `packages/cli/src/commands/__tests__/stats.test.ts` | CLI command tests |
| `packages/core/src/db/schema.ts` | Add `commitSnapshots` table |

## Integration with commit.ts

Minimal change to `commitAction()`:

```typescript
// After successful git commit (step 6), before post-commit hooks (step 7):
import { recordSnapshot } from "@maina/core";

// Only record if commit succeeded
if (exitCode === 0) {
  await recordSnapshot({
    branch,
    commitHash: extractHash(stdout),
    verifyDurationMs: pipelineResult.duration,
    totalDurationMs: Date.now() - startTime,
    contextTokens: /* from context assembly if available, else 0 */,
    contextBudget: /* from budget, else 200000 */,
    cacheHits: cacheStats.l1Hits + cacheStats.l2Hits,
    cacheMisses: cacheStats.misses,
    findingsTotal: pipelineResult.findings.length,
    findingsErrors: pipelineResult.findings.filter(f => f.severity === "error").length,
    findingsWarnings: pipelineResult.findings.filter(f => f.severity === "warning").length,
    toolsRun: pipelineResult.tools.length,
    syntaxPassed: pipelineResult.syntaxPassed,
    pipelinePassed: pipelineResult.passed,
  });
}
```

## Scope boundaries

- No AI calls — purely deterministic
- No external services — SQLite only
- No charts or visualizations — terminal text
- No config needed — works automatically once implemented
- Not registered as a user-facing feature — internal diagnostic
- Graceful failure: if stats recording fails, commit still succeeds (never blocks the user)
