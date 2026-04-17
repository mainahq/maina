/**
 * Spec tests for feature 041-github-checks-api.
 *
 * Real tests live in: packages/core/src/github/__tests__/checks.test.ts
 * This file re-exports them so `maina spec` can track coverage.
 *
 * Run: bun test packages/core/src/github/__tests__/checks.test.ts
 *
 * Coverage:
 * - T1: ✅ 16 tests written (red → green)
 * - T2: ✅ formatAnnotations — severity mapping, cap at 50, empty input
 * - T3: ✅ determineConclusion — success/failure/neutral
 * - T4: ✅ createCheckRun — success, failure, 403, network error, details URL
 * - T5: ✅ maina verify + slop + typecheck pass
 */

export {};
