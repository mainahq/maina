---
name: verification-workflow
description: Run maina's full verification pipeline on staged changes before committing code.
triggers:
  - "verify code"
  - "check code quality"
  - "run verification"
  - "before committing"
---

# Verification Workflow

## When to use

Before committing any code change. The verification pipeline catches syntax errors, security issues, secrets, and code smells on only the lines you changed, so you fix problems before they reach the repository.

## Steps

1. **Stage your changes** with `git add` as usual.
2. **Run the pipeline** with `maina verify`. This runs the full verification sequence on staged files only.
3. **Syntax guard (< 500ms):** Biome checks formatting and lint rules first. If this fails, nothing else runs -- fix syntax before proceeding.
4. **Parallel tool sweep:** Once syntax passes, these tools run simultaneously:
   - **Semgrep** -- pattern-based static analysis for bugs and anti-patterns
   - **Trivy** -- vulnerability scanning for dependencies and container configs
   - **Secretlint** -- detects accidentally committed secrets, tokens, and keys
   - **Slop detector** -- catches AI-generated filler text ("I'd be happy to", placeholder code, etc.)
5. **Diff-only filter:** Results are filtered to only new or changed lines. Existing issues in untouched code are ignored.
6. **Review findings:** Each finding includes file path, line number, severity, explanation, and a suggested fix.
7. **Fix and re-run:** Address findings, re-stage, and run `maina verify` again until clean.
8. **Commit through maina:** Use `maina commit` instead of `git commit`. This ensures the verification pipeline ran and attaches verification metadata to the commit.

## Example

```bash
# Stage changes
git add src/auth/login.ts src/auth/__tests__/login.test.ts

# Run verification
maina verify

# Output:
# [syntax]  PASS  Biome check (320ms)
# [semgrep] WARN  src/auth/login.ts:42 — Potential SQL injection in query builder
# [trivy]   PASS  No vulnerabilities found
# [secret]  PASS  No secrets detected
# [slop]    PASS  No filler text detected
#
# 1 finding on changed lines. Fix before committing.

# Fix the issue, re-stage, verify again
maina verify
# All checks passed.

# Commit with verification metadata
maina commit
```

## Notes

- The pipeline is designed for speed: syntax guard exits early on failure, parallel tools maximize throughput.
- Use `maina verify --focused` for a narrower context budget (40%) on small, targeted changes.
- Use `maina verify --explore` for a wider budget (80%) when making broad refactors.
