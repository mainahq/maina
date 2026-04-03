---
name: code-review
description: Run maina's two-stage AI code review checking spec compliance then code quality.
triggers:
  - "review code"
  - "code review"
  - "check this PR"
  - "review changes"
---

# Code Review

## When to use

When changes are ready for review, before merging a PR, or when you want a structured assessment of code quality. The two-stage review ensures changes both match the plan and meet quality standards.

## Steps

1. **Run the review** with `maina review`. This performs a two-stage AI-powered review on the current diff.
2. **Stage 1 -- Spec Compliance:** The reviewer checks whether the changes fulfill the plan:
   - Do the changes implement what the spec and plan describe?
   - Are all acceptance criteria addressed?
   - Is anything implemented that was explicitly out of scope?
   - Are there gaps where planned behavior is missing?
3. **Stage 2 -- Code Quality:** The reviewer evaluates the implementation itself:
   - Clean code: naming, structure, readability, duplication.
   - Tests: adequate coverage, meaningful assertions, edge cases.
   - Security: input validation, authentication checks, data handling.
   - Performance: obvious inefficiencies, unnecessary allocations, N+1 queries.
   - Error handling: Result types used correctly, no unhandled failures.
4. **Findings are categorized by severity:**
   - **Critical:** Must fix before merge. Security vulnerabilities, data loss risks, broken functionality.
   - **Important:** Should fix before merge. Missing tests, poor error handling, unclear logic.
   - **Minor:** Consider fixing. Style suggestions, naming improvements, documentation gaps.
5. **Each finding includes:**
   - File path and line number.
   - Why it matters (not just what is wrong).
   - A concrete suggestion for how to fix it.
6. **Final verdict:**
   - **Ready:** No critical or important findings. Ship it.
   - **Ready with fixes:** Important findings exist but are straightforward to address.
   - **Not ready:** Critical findings that need rework before another review.

## Example

```bash
maina review

# Stage 1: Spec Compliance
# PASS  All 3 acceptance criteria addressed
# WARN  src/auth/oauth.ts — OAuth flow implemented but marked out-of-scope in spec
#
# Stage 2: Code Quality
# CRITICAL  src/auth/login.ts:67 — Password compared with === instead of timing-safe comparison
#   Why: Enables timing attacks to guess passwords character by character.
#   Fix: Use crypto.timingSafeEqual() for password comparison.
#
# IMPORTANT  src/auth/__tests__/login.test.ts — No test for failed login attempt
#   Why: Error path is untested; regressions will go unnoticed.
#   Fix: Add test case for invalid credentials returning 401.
#
# MINOR  src/auth/session.ts:12 — Variable name 'x' is unclear
#   Why: Reduces readability for future maintainers.
#   Fix: Rename to 'sessionExpiryMs' to reflect its purpose.
#
# Verdict: Ready with fixes (1 critical, 1 important, 1 minor)
```

## Notes

- The review only examines changed lines (diff-only filter), so existing technical debt does not pollute results.
- This is the one maina command that makes two LLM calls: one for each review stage.
- Combine with `maina verify` for the complete pre-merge pipeline: deterministic tools first, then AI review.
