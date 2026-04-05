# v0.4.0 — Polish + CI

## Problem Statement

Maina CLI is not CI-ready. Commands output human-readable text only — no `--json` for machine parsing. Exit codes are inconsistent (always 0 or 1). No GitHub Action for easy CI integration. Polyglot repos only detect the primary language, missing per-file analysis. PHP is the 4th most popular backend language and has no support. DAST and performance auditing are missing from the verification pipeline.

## Target User

- Primary: Teams adopting maina in CI pipelines (GitHub Actions, GitLab CI)
- Secondary: PHP developers, polyglot repo maintainers, security-conscious teams

## User Stories

- As a CI engineer, I want `maina verify --json` so I can parse results programmatically and fail builds on errors.
- As a CI engineer, I want meaningful exit codes so my pipeline can distinguish "passed", "warnings only", and "failed".
- As a CI engineer, I want `mainahq/verify-action` GitHub Action so I can add maina to any repo in 3 lines of YAML.
- As a PHP developer, I want maina to run PHPStan and Psalm on my code.
- As a polyglot developer, I want maina to detect the language of each file, not just the project's primary language.
- As a security engineer, I want DAST (ZAP) to scan my web app for runtime vulnerabilities.
- As a frontend developer, I want Lighthouse auditing for performance, accessibility, and SEO.

## Success Criteria

- [ ] `maina verify --json` outputs valid JSON with findings, tools, duration
- [ ] `maina commit --json`, `maina review --json`, `maina stats --json` all work
- [ ] Exit code 0 = passed, 1 = findings with errors, 2 = tool failure, 3 = configuration error
- [ ] `mainahq/verify-action` GitHub Action works in a sample repo
- [ ] PHP language profile detects PHPStan/Psalm, runs them, parses output to Finding[]
- [ ] Polyglot repo with .ts + .py files runs both biome and ruff
- [ ] ZAP integration runs DAST against a configured target URL
- [ ] Lighthouse integration runs perf/a11y/SEO audit and produces findings

## Scope

### In Scope

- `--json` flag on all commands
- Exit codes (0/1/2/3)
- GitHub Action (`mainahq/verify-action`)
- PHP language profile (PHPStan, Psalm)
- Per-file language detection
- ZAP DAST integration
- Lighthouse integration

### Out of Scope

- GitLab CI / Buildkite integrations (deferred to v0.6.0 hosted verify)
- PHP framework-specific rules (Laravel, Symfony)
- Lighthouse CI (scheduled runs) — just single-run auditing for now

## Design Decisions

- **--json uses same internal types** — PipelineResult, ReviewResult, etc. are already structured. --json just serializes them instead of formatting for terminal.
- **Exit codes follow UNIX conventions** — 0 success, non-zero failure. We add 2 (tool failure) and 3 (config error) beyond the standard 0/1.
- **Per-file detection extends existing LanguageProfile system** — Each file gets its own profile lookup based on extension, used for syntax guard and slop detection.
- **ZAP runs as a Docker container** — Most teams already have Docker. ZAP outputs SARIF which we already parse (same as Semgrep).
- **Lighthouse uses the npm package** — `lighthouse` CLI outputs JSON, parsed into Finding[].
