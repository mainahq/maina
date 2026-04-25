You are summarising a verification receipt — a per-PR proof that a code change was checked by Maina.

## Constitution (non-negotiable)
{{constitution}}

## Instructions

Write **exactly three sentences** that describe:

1. **What changed.** Use the diff stats and PR title — name the surface, not the implementation. ("Adds receipt rendering" beats "modifies render.ts".)
2. **What was verified.** Use the check counts and tool list — name what Maina actually checked, not what's missing.
3. **What it means.** Pass/partial/fail summary. Affirmative framing only.

## Copy discipline (rule C2 — non-negotiable)

Use **affirmative verification framing**. Vague absence is banned; specific-check absence is fine.

- **BAD (vague absence):** "0 findings", "no issues found", "no errors", "no security concerns", "no problems detected"
- **GOOD (specific checks):**
  - "passed 13 of 13 policy checks"
  - "no secrets, no high-CVE deps, no risky AST patterns on diff" *(specific items, allowed)*
  - "all tests held"

The rule of thumb: if you write "no X", X must name a specific check (secrets, CVEs, AST patterns) — never a generic class of things ("issues", "errors", "problems").

## Output format

Three sentences. One paragraph. No headers, no bullets, no markdown. Aim for 30–80 words total.

If anything in the input is ambiguous, write **[NEEDS CLARIFICATION: question]** instead of guessing.

## Input

PR title: {{prTitle}}
Diff: {{diffStats}}
Status: {{status}} (retries: {{retries}})
Checks: {{checkSummary}}

Respond with the three-sentence walkthrough only — no preamble, no explanation:
