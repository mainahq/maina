# Decision: v0.4.0 Polish + CI

> Status: **accepted**

## Context

Maina CLI outputs human-readable text only. CI pipelines need machine-readable JSON, meaningful exit codes, and a GitHub Action for easy integration. The language profile system only detects a project's primary language, missing per-file analysis in polyglot repos. PHP (4th most popular backend language) has no support. DAST and performance auditing are gaps in the verification pipeline.

## Decision

Add 7 features in 4 phases: structured output (--json, exit codes), CI integration (GitHub Action), language expansion (PHP, per-file detection), and new verification tools (ZAP DAST, Lighthouse).

## Rationale

### Positive

- Every maina command becomes CI-ready with `--json` and meaningful exit codes
- GitHub Action makes adoption a 3-line YAML change
- PHP developers can use maina
- Polyglot repos get accurate per-file analysis
- Security and performance coverage expands

### Negative

- ZAP requires Docker, adding a dependency for DAST
- Lighthouse adds ~5s to verification when enabled
- More language profiles = more maintenance surface

### Neutral

- --json flag adds minimal code per command (serialize existing types)
- Exit codes are a one-time change to the CLI entrypoint

## Affected Entities

- `src/commands/*.ts`
- `src/index.ts`
- `src/json.ts`
- `src/language/profile.ts`
- `src/language/detect.ts`
- `src/verify/pipeline.ts`
- `src/verify/zap.ts`
- `src/verify/lighthouse.ts`
