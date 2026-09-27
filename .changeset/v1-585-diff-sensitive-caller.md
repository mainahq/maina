---
"@mainahq/core": patch
---

`diff.sensitive` now has a caller and a heuristic. The verify review triage asks it one yes/no question about the whole diff, next to `diff.needs_review`. A yes, or an unsure no, asks for the deep review. Its state is the `diff.needs_review` state (`additions`, `deletions`, `files`, `paths`) plus `untrusted.patch`: the diff's zero-context text, cut at 6,000 code points. The heuristic says yes when a path names security-sensitive code (auth, tokens, secrets, crypto and similar). Business-critical paths such as billing, payments, sessions, migrations and env still ask for a deep review through `diff.needs_review`, but they are not security-sensitive. When only `diff.sensitive` asks for the deep review, the receipt's triage cites its decision and confidence, not `diff.needs_review`'s.
