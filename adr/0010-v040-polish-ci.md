# 0010. v0.4.0 Polish + CI

Date: 2026-04-05

## Status

Accepted

## Context

Maina CLI outputs human-readable text only. CI pipelines need machine-readable JSON, meaningful exit codes, and a GitHub Action for easy integration. The language profile system only detects a project's primary language, missing per-file analysis in polyglot repos. PHP (4th most popular backend language) has no support. DAST and performance auditing are gaps in the verification pipeline.

## Decision

Add 7 features in 4 phases: structured output (--json, exit codes), CI integration (GitHub Action), language expansion (PHP, per-file detection), and new verification tools (ZAP DAST, Lighthouse).

## Consequences

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

## High-Level Design

### Phases

```
Phase 1: Structured output (--json flag, exit codes)
  |
Phase 2: CI integration (GitHub Action)
  |
Phase 3: Language expansion (PHP profile, per-file detection)
  |
Phase 4: New tools (ZAP DAST, Lighthouse)
```

### Component Boundaries

```
cli/src/commands/*.ts ── add --json flag + JSON formatting
cli/src/index.ts ── exit code mapping
cli/src/json.ts (NEW) ── shared JSON output formatter

core/src/language/profile.ts ── add PHP profile
core/src/language/detect.ts ── per-file detection
core/src/verify/pipeline.ts ── per-file language routing

core/src/verify/zap.ts (NEW) ── ZAP DAST runner + SARIF parser
core/src/verify/lighthouse.ts (NEW) ── Lighthouse runner + JSON parser

.github/actions/verify/action.yml (NEW) ── GitHub Action
```

### Data Flow

**--json flag:**
```
Command → existing logic → Result type → JSON.stringify → stdout
```
No new types needed — PipelineResult, ReviewResult, etc. are already structured.

**Per-file language detection:**
```
files[] → extension → LanguageProfile lookup → per-file syntax guard + slop
```

**ZAP:**
```
target URL → docker run zaproxy/zap-stable → SARIF output → parseSarif() → Finding[]
```

**Lighthouse:**
```
target URL → lighthouse CLI → JSON output → parseLighthouseJson() → Finding[]
```

## Low-Level Design

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Passed — no error-severity findings |
| 1 | Failed — error-severity findings found |
| 2 | Tool failure — a verification tool crashed |
| 3 | Configuration error — missing config, bad arguments |

### New Interfaces

```typescript
// cli/src/json.ts
export function formatJson(result: unknown): string;
export function exitWithCode(result: PipelineResult | ReviewResult): never;

// core/src/language/detect.ts
export function detectFileLanguage(filePath: string): LanguageId | null;

// core/src/verify/zap.ts
export interface ZapOptions { targetUrl: string; cwd: string; available?: boolean; }
export interface ZapResult { findings: Finding[]; skipped: boolean; }
export async function runZap(options: ZapOptions): Promise<ZapResult>;

// core/src/verify/lighthouse.ts
export interface LighthouseOptions { url: string; cwd: string; available?: boolean; }
export interface LighthouseResult { findings: Finding[]; skipped: boolean; scores: Record<string, number>; }
export async function runLighthouse(options: LighthouseOptions): Promise<LighthouseResult>;
```

### PHP Language Profile

```typescript
export const PHP_PROFILE: LanguageProfile = {
  id: "php",
  displayName: "PHP",
  extensions: [".php"],
  syntaxTool: "phpstan",
  syntaxArgs: (files) => ["phpstan", "analyse", "--error-format=json", ...files],
  testFilePattern: /(?:Test\.php$|tests\/)/,
  printPattern: /\b(?:echo|print|var_dump|print_r|error_log)\s*\(/,
  // ...
};
```

### Error Handling

- --json on a failing command still outputs valid JSON with an error field
- Exit codes set via process.exitCode, not process.exit() (allows cleanup)
- ZAP Docker not available → skip with info note (same as other tools)
- Lighthouse not installed → skip with info note
