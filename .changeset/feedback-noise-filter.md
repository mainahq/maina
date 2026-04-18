---
"@mainahq/cli": patch
"@mainahq/core": patch
---

fix(feedback): drop auto-generated PR-summary comments during ingest

`maina feedback ingest` now skips comments whose body starts with one of CodeRabbit's auto-generated summary HTML markers:

- `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->`
- `<!-- This is an auto-generated comment: review in progress by coderabbit.ai -->`
- `<!-- This is an auto-generated comment: skip review by coderabbit.ai -->`

These issue-level boilerplate comments carry no actionable signal but were being categorised as `security` because their body contains words the keyword classifier picked up — they were dragging the unfiltered categorisation accuracy from ~9/10 down by adding ~10 false-positive `security` rows per session.

Real review comments that merely *mention* "auto-generated" (e.g. discussing a rule that fires on generated code) are unaffected — the marker must appear at the start of the body. New `isAutoSummaryComment(body)` helper is exported so other consumers can run the same filter.

Locked in by 5 new `isAutoSummaryComment` unit tests (each known marker, leading-whitespace tolerance, prose-mention rejection, unrelated HTML rejection, empty/whitespace-only body) + one end-to-end ingest test that verifies a summary boilerplate and a real review comment from the same reviewer ingest as `(skipped: 1, ingested: 1)`.
