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
2. **Run the pipeline** with `"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli verify` (or call the `verify` MCP tool). This runs the full verification sequence on staged files only.
3. **Syntax guard (< 500ms):** Biome checks formatting and lint rules first. If this fails, nothing else runs -- fix syntax before proceeding.
4. **Parallel tool sweep:** Once syntax passes, 18+ tools run simultaneously:
   - **Semgrep** -- pattern-based static analysis for bugs and anti-patterns
   - **Trivy** -- vulnerability scanning for dependencies and container configs
   - **Secretlint** -- detects accidentally committed secrets, tokens, and keys
   - **Slop detector** -- catches AI-generated filler text and placeholder code
   - **Typecheck** -- `tsc --noEmit` for TypeScript projects
   - **Consistency** -- cross-function AST-based consistency check
   - Plus SonarQube, Stryker, diff-cover, ZAP, Lighthouse when installed.
5. **Diff-only filter:** Results are filtered to only new or changed lines. Existing issues in untouched code are ignored.
6. **Review findings:** Each finding includes file path, line number, severity, explanation, and a suggested fix.
7. **Fix and re-run:** Address findings, re-stage, and run `"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli verify` again until clean.
8. **Commit through maina:** Use `"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli commit` instead of `git commit`. This ensures the verification pipeline ran and attaches verification metadata to the commit.
9. **MCP alternative:** Verification and review are also available as MCP tools (`verify`, which includes slop detection, and `review_triage`) when running inside an AI coding tool.

## Example

```bash
# Stage changes
git add src/auth/login.ts src/auth/__tests__/login.test.ts

# Run verification
"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli verify

# Output:
# [syntax]  PASS  Biome check (320ms)
# [semgrep] WARN  src/auth/login.ts:42 — Potential SQL injection in query builder
# [trivy]   PASS  No vulnerabilities found
# [secret]  PASS  No secrets detected
# [slop]    PASS  No filler text detected
#
# 1 finding on changed lines. Fix before committing.

# Fix the issue, re-stage, verify again
"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli verify
# All checks passed.

# Commit with verification metadata
"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli commit
```

## Notes

- The pipeline is designed for speed: syntax guard exits early on failure, parallel tools maximize throughput.
- Use `"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli verify --focused` for a narrower context budget (40%) on small, targeted changes.
- Use `"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli verify --explore` for a wider budget (80%) when making broad refactors.
- Use `"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli verify --deep` to add AI semantic review (spec compliance + code quality).
- Use `"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli verify --cloud` to run the pipeline on Maina Cloud (no local tools needed).
- Use `"${CLAUDE_PLUGIN_ROOT}/launcher/launch.sh" cli verify --visual` to add Playwright screenshot regression testing.
