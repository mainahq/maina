# Feature 018: Verification Proof Artifacts in PR Body

## Problem

PRs claim verification passed but include no evidence. No way to audit what tools ran, what they found, or what visual state looks like. Trust is claimed, not proven.

## Success Criteria

- **SC-1:** `buildVerificationProof(mainaDir, cwd, options)` returns a markdown string with collapsible proof sections
- **SC-2:** Proof includes: pipeline results (per-tool table), test count, code review results, slop check results
- **SC-3:** Visual proof included when baselines exist (page list with diff percentages)
- **SC-4:** `maina pr` appends verification proof to the PR body automatically
- **SC-5:** Each section uses `<details>` for collapsibility
- **SC-6:** Works without visual baselines (omits visual section)
- **SC-7:** Workflow context summary included if available

## Out of Scope

- Uploading screenshot images to GitHub (just reference local paths for now)
- CI integration (this is for local `maina pr` usage)
- Blocking PR creation on verification failure (just report)

## Design

### New module: `packages/core/src/verify/proof.ts`

```typescript
interface VerificationProof {
  pipeline: { tool: string; findings: number; duration: number; skipped: boolean }[];
  tests: { passed: number; failed: number; files: number } | null;
  review: { stage1Passed: boolean; stage2Passed: boolean; findings: number } | null;
  slop: { findings: number } | null;
  visual: { pages: number; regressions: number } | null;
  workflowContext: string | null;
}

async function gatherVerificationProof(mainaDir, cwd, options): Promise<VerificationProof>
function formatVerificationProof(proof: VerificationProof): string  // returns markdown
```

### Integration into `maina pr`

In `prAction`, after generating the PR body, call `gatherVerificationProof` and append the formatted markdown to the body before creating the PR.

## Files to Change

| File | Change |
|------|--------|
| `packages/core/src/verify/proof.ts` | NEW — gather + format verification proof |
| `packages/core/src/verify/__tests__/proof.test.ts` | NEW — tests |
| `packages/cli/src/commands/pr.ts` | Append proof to PR body |
| `packages/core/src/index.ts` | Export new module |
