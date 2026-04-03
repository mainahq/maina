# Tier 3 Benchmark Report — validator.js Subset

## Methodology

**Story:** Input validation library (`isEmail`, `isURL`, `isIP`) — RFC compliance, unicode, security edge cases.

**Key innovation: ML-style train/validation split**
- **Training tests (34):** Given to both AI pipelines during implementation. Straightforward happy/sad path cases.
- **Validation tests (95):** Hidden from both pipelines. Edge cases, security traps, option interactions, boundary conditions.
- **Spec:** One-shot — detailed requirements with deliberate ambiguity. No hand-holding.

The training tests guide implementation direction. The validation tests reveal generalization quality.

---

## Results

| Metric | Maina | Spec Kit |
|--------|-------|----------|
| **Training passed** | 34/34 (100%) | 34/34 (100%) |
| **Validation passed** | 94/95 (98.9%) | 94/95 (98.9%) |
| **Total duration** | ~204s | ~141s |
| **Implementation LOC** | 403 | 504 |
| **Attempts to pass** | 1 | 1 |
| **Verify findings** | 2 (warning/error) | N/A |
| **Review issues** | 0 actionable | 1 (self-review) |
| **Bugs introduced** | 1 | 1 |
| **Bugs caught by pipeline** | 0 | 0 |

**Winner: Tie** — identical validation pass rates, same bug in both.

---

## The Bug Neither Caught

Both implementations accept `http://999.999.999.999` as a valid URL. The spec explicitly states:

> "IP addresses are validated according to isIP rules"

Both pipelines implemented `isIP` correctly (rejects `256.0.0.0`, `999.999.999.999`). But neither wired `isIP` into `isURL`'s host validation path. This is a **cross-function integration bug** — the components exist but aren't connected.

### Why Maina's pipeline didn't catch it

- **Verify** caught 3 issues (2 style, 1 info) but didn't flag IP host validation
- **Review** noted "host delegation" as info-level but didn't escalate to actionable
- The signal was present but below the action threshold

### Why Spec Kit's pipeline didn't catch it

- **Self-review** caught 1 issue (Gmail dead code) through manual code reading
- No verification tools to surface integration gaps

---

## Pipeline Comparison

### Maina Pipeline Steps
| Step | Duration | Output |
|------|----------|--------|
| Context | ~5.2s | Codebase context via MCP |
| Implement | ~122s | 403-line validator.ts |
| Test | <1s | 34/34 pass |
| Verify | ~16s | 2 findings (fixed), 0 on re-run |
| Review | ~61s | Two-stage review, 0 actionable |
| **Total** | **~204s** | |

### Spec Kit Pipeline Steps
| Step | Duration | Output |
|------|----------|--------|
| Plan | ~10s | Mental planning |
| Implement | ~90s | 504-line validator.ts |
| Test | ~16s | 34/34 pass |
| Self-review | ~24s | 1 issue found+fixed |
| **Total** | **~141s** | |

---

## Learnings

### 1. Train/validation split is essential
Without the hidden validation set, both pipelines show 100% and appear identical. The validation set reveals the 1 bug that matters — justifying the methodology.

### 2. Cross-function integration is the gap
Both AI agents implement individual functions correctly but miss the wiring between them. The spec says "use isIP for IP hosts" — a spec-compliance checker should flag this.

### 3. Maina's verify had the signal
The review step noted "host delegation" as info-level. Tuning the review prompt to escalate cross-function spec compliance from info → warning would have caught this bug.

### 4. Speed vs safety tradeoff
Spec Kit is 31% faster (141s vs 204s) because it skips verify+review. Maina is slower but produces leaner code (403 vs 504 LOC) and catches real issues (unused vars, formatting). On tier 3 complexity, the safety margin didn't manifest as better validation scores.

### 5. Action items for Maina
- Escalate cross-function integration checks in review prompt
- Add "spec compliance" as a verification dimension (does the code implement what the spec says?)
- Consider running validation-style tests as part of the verify pipeline

---

## Tier Progression Summary

| Metric | Tier 1 (mitt) | Tier 2 (ms) | Tier 3 (validator) |
|--------|--------------|-------------|-------------------|
| Complexity | Easy | Medium | Hard |
| Tests | 15 | 45-56 | 34 train + 95 val |
| Functions | 1 | 3 | 3 (multi-concern) |
| Maina pass rate | 100% | 100% | 100% train / 98.9% val |
| SpecKit pass rate | 100% | 100% | 100% train / 98.9% val |
| Winner | Tie | Tie | Tie |
| Key finding | Both ace trivial | Both ace medium | Integration bugs escape both |

**Conclusion (partial run):** On current model capability (Opus 4.6), both pipelines produce equally correct code at all complexity levels. The differentiator is not correctness but **what gets caught before merge** — and neither pipeline currently catches cross-function integration bugs. The train/validation split methodology is the right way to measure this going forward.

---

## Full Lifecycle Run (init → commit)

### Results

| | Maina | Spec Kit |
|---|---|---|
| **Training** | 34/34 (100%) | 34/34 (100%) |
| **Validation** | **93/95 (97.9%)** | **95/95 (100%)** |
| **Total duration** | ~74s | ~271s |
| **Implementation LOC** | 460 | 496 |
| **Steps completed** | 6/9 | 8/8 |
| **Steps skipped** | 2 (interactive) | 0 |
| **Artifacts created** | 7 | 6 |
| **Issues found by review** | 0 | 4 |
| **Winner** | | **Spec Kit** |

### Spec Kit wins the full lifecycle

Spec Kit achieved **100% on hidden validation tests** vs Maina's 97.9%. The key difference:

- Spec Kit's self-review spent **58 seconds** carefully reading code, finding **4 real issues** (Gmail validation, dead code, stale comments, missing control char rejection)
- Maina's verify ran in **137ms** and found **0 issues** — because no linters were installed in the benchmark project
- Maina's review ran in **128ms** and passed everything

### Maina's specific failures

1. `isURL("http://999.999.999.999")` — URL validator doesn't check IP host ranges via isIP
2. `isIP(":2001:db8::1")` — IPv6 parser accepts leading single colon

### Why Maina lost

**The verify pipeline was a no-op.** In a fresh project without Biome/Semgrep/Trivy installed, `maina verify` has nothing to run. It returned 0 findings in 137ms — false safety.

Additionally, `maina spec` and `maina design` required interactive input and were skipped. Maina completed only 6/9 lifecycle steps.

### Action items

1. **maina verify must work standalone** — needs built-in checks that don't depend on external tools (TypeScript type checking, basic pattern matching, cross-function consistency)
2. **Add --auto flags** to spec/design commands for CI and benchmark use
3. **Self-review is powerful** — consider adding an LLM-based self-review step to maina verify that doesn't depend on installed tools
4. **Don't report "0 findings" when no tools ran** — that's misleading. Report "0 tools available" as a warning
