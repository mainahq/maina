# Architecture: Verification Pipeline

> Auto-generated architecture article listing all verify tools.

The verification pipeline runs a multi-stage process to prove AI-generated code is correct before it merges.

## Pipeline Stages

1. **Syntax Guard** — Fast linting (<500ms)
2. **Parallel Deterministic Tools** — Semgrep, Trivy, Secretlint, SonarQube, coverage, mutation
3. **Diff-Only Filter** — Only report findings on changed lines
4. **AI Fix** — Automatic fix suggestions
5. **Two-Stage AI Review** — Spec compliance, then code quality

## Verify Tools

- **ai-review** — Two-stage AI review (spec compliance + code quality)
- **builtin** — Built-in verification checks
- **consistency** — Code consistency analysis
- **coverage** — Code coverage tracking via diff-cover
- **detect** — Language and tool detection
- **diff-filter** — Diff-only filter — only report findings on changed lines
- **fix** — AI-powered automatic fix suggestions
- **lighthouse** — Lighthouse performance audits
- **mutation** — Mutation testing via Stryker
- **pipeline** — Verification pipeline orchestrator
- **proof** — Verification proof generation for PR bodies
- **secretlint** — Secret detection in code and config files
- **semgrep** — Static analysis via Semgrep rules
- **slop** — AI slop detection — catches lazy/generic AI output patterns
- **sonar** — SonarQube code quality analysis
- **syntax-guard** — Fast syntax checking (<500ms) via language-specific linters
- **trivy** — Container and dependency vulnerability scanning
- **typecheck** — TypeScript type checking
- **types** — `verify/types.ts`
- **visual** — Visual verification with Playwright
- **zap** — OWASP ZAP security scanning

## Language-Specific Linters

- **checkstyle** — `verify/linters/checkstyle.ts`
- **clippy** — `verify/linters/clippy.ts`
- **dotnet-format** — `verify/linters/dotnet-format.ts`
- **go-vet** — `verify/linters/go-vet.ts`
- **ruff** — `verify/linters/ruff.ts`

## Additional Tools

- **wiki-lint-runner** — `verify/tools/wiki-lint-runner.ts`
- **wiki-lint** — `verify/tools/wiki-lint.ts`
