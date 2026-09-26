---
"@mainahq/core": minor
"@mainahq/cli": minor
---

PR receipt check run and sticky comment v2 (#348).

- `renderReceiptComment(receipt, { discoveryLine })` turns a receipt into the PR comment markdown: the verify result and scope ("passed N of M checks across F files, changed lines against `base`"), the review triage decision and its confidence, the gate counts and each override, every acceptance criterion with its evidence, the checks, and a link to the full receipt. It is pure and deterministic, and escapes user text so it cannot break the table, inject HTML or @-mention anyone.
- `publishReceipt({ pr, receipt, auth, http, optIn })` upserts exactly one sticky comment (found by a hidden marker, duplicates folded) and one `maina/receipt` check run on the head commit, both updated in place on every republish. Nothing is requested without `optIn`. With a read-only token (a fork PR) it writes nothing and returns the markdown as a `fallback`; a write refused with 403 falls back the same way.
- `maina receipt publish --receipt <path> --pr <n> --sha <sha> --opt-in` publishes from the CLI (`GITHUB_TOKEN`, `GITHUB_REPOSITORY`), merging criteria, scope and gate counts from `--context <json>`. On `--read-only` it appends the receipt to `$GITHUB_STEP_SUMMARY`.
- The verify Action gains `pr-comment` (off by default), `github-token`, `comment-author`, `discovery-line` and `receipt-context` inputs. With `pr-comment: "true"` it builds a receipt for the PR's changes, uploads it as the `maina-receipt` artifact and publishes it. On a fork PR it writes the receipt to the job summary, which the job's own check run shows.
