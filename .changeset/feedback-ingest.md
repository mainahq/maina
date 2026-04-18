---
"@mainahq/cli": minor
"@mainahq/core": minor
---

feat(core,cli): ingest external code-review findings as labeled training signal (issue #185)

Adds `maina feedback ingest` plus a new `external_review_findings` table in `.maina/feedback.db`. Pulls review comments from configured reviewers (`copilot-pull-request-reviewer`, `coderabbitai`, plus any `--reviewer <login>`) on open + recently merged PRs and stores them with file/line, reviewer kind, a heuristic category (`api-mismatch`, `signature-drift`, `dead-code`, `security`, `style`, `other`), and the diff hunk that was being reviewed.

**Why:** across the v1.4.x dogfood loop Copilot caught 30+ accuracy bugs in PRs that `maina commit` had blessed (wrong export names, signature drift, claims about API shape that the source contradicts). Each finding is a **labeled `(input, output)` pair** — input is the diff Maina blessed, output is the bug a reviewer caught. Treating those as training data is more valuable than any hand-coded rule.

**This is the v1 thin slice:**

- `external_review_findings` schema + indexes on `(file_path)` and `(pr_repo, pr_number)`, idempotent on `(pr_repo, pr_number, source_id)`.
- `ingestComments` / `ingestPrReviews` / `insertFinding` / `queryFindings` / `getTopCategoriesByFile` in `@mainahq/core`.
- Deterministic keyword categoriser (no LLM in the hot path — `other` when nothing matches).
- `maina feedback ingest [--repo <slug>] [--pr <n>] [--since <days>] [--reviewer <login>] [--json]`.
- `maina stats` surfaces a "Top external-review categories" section once the table has data.
- 20 new tests covering categorisation, dedupe, allow-list filtering, DB round-trip, and aggregation.

**Out of scope (v2):**

- The RL closure (`maina commit` consults the DB during verify and warns on touched files with prior findings)
- Per-project policy training (`maina feedback train`)
- Slop ruleset evolution from accumulated findings
- LLM-backed reclassification of the `other` bucket
- Cloud sync of findings

Storage is **local only** today.
