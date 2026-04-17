# Decision: Interview gap-filler for constitution

> Status: **accepted**

## Context

Config parsers, git analyzers, and pattern samplers detect ~70% of conventions. The remaining ~20% needs human input: files AI should never touch, deploy gotchas, common contributor mistakes. Rejected proposals should persist so `maina learn --update` doesn't re-ask.

## Decision

3 fixed interview questions (deterministic, not AI-generated):
1. "Files AI should never touch?" → glob patterns
2. "Deploy-time gotchas?" → free text
3. "What does every new contributor get wrong?" → free text

Rejected rules stored in `.maina/rejected.yml` as a simple list. `filterProposals()` removes any rule whose text matches a rejected entry.

Human-provided answers get confidence 0.8 (higher than scan-inferred 0.4-0.7, lower than explicit config 1.0).

## Rationale

### Positive
- Fills gaps that automated scanners can't detect
- Rejected rules persist — no re-asking
- Non-TTY mode works (returns questions + defaults)

### Negative
- Fixed questions may not cover every project's unique needs (acceptable — 3 high-value questions cover the most common gaps)
