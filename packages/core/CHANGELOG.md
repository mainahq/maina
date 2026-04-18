# @mainahq/core

## 1.6.1

### Patch Changes

- [`99e2e68`](https://github.com/mainahq/maina/commit/99e2e68c470f06e555086e7905817ce07a5b6c80) Thanks [@beeeku](https://github.com/beeeku)! - **Harden `maina sync pull` + broaden `--debug`**

  Follow-up to [#194](https://github.com/mainahq/maina/issues/194), addresses [#196](https://github.com/mainahq/maina/issues/196).

  - `DEBUG=1` and `NODE_DEBUG=1` are now honoured as aliases for `MAINA_DEBUG=1`. Users naturally reach for the generic env var first.
  - `maina sync pull` now validates each prompt's `path` and `content` before writing to disk. Malformed records are skipped with a per-record reason instead of throwing out of the loop and leaving `@clack/prompts`' spinner monitor to print a generic `"Something went wrong"`. `mkdirSync` failures are caught and surfaced.
  - Empty-team response now shows `log.info("No team prompts yet.")` instead of a misleading `log.success("Pulled 0 prompt(s)")`.
  - Partial success (some records written, some skipped) surfaces a warning with the skipped count + reasons.

## 1.6.0

### Minor Changes

- [`d90d126`](https://github.com/mainahq/maina/commit/d90d126231ddaff236e9bb5025f88a9c1057a47e) Thanks [@beeeku](https://github.com/beeeku)! - **CLI errors & GitHub login**

  - `maina login --github` — sign in with GitHub via device flow, then exchange for a maina token at `/auth/github/exchange`. Fixes the duplicate-account bug where the device flow created UUID+email members while the web flow keyed by `github_id` ([#193](https://github.com/mainahq/maina/issues/193)).
  - Top-level `uncaughtException` / `unhandledRejection` handler prints `err.code` + `err.message` instead of the generic `"Something went wrong"`. Pass `--debug` (or set `MAINA_DEBUG=1`) for the full stack trace ([#192](https://github.com/mainahq/maina/issues/192)).
  - Anonymous CLI crash reporting — fire-and-forget POST to `/v1/cli/errors` with a scrubbed payload (paths → basenames, secrets/emails/IPs redacted). Opt out via `MAINA_TELEMETRY=0`, `DO_NOT_TRACK=1`, or `~/.maina/telemetry.json` `{ "optOut": true }` ([#192](https://github.com/mainahq/maina/issues/192)).
  - `maina sync pull` no longer crashes when the team has no prompts — prints `"No team prompts yet."` instead.
  - `maina team` falls back to the server's `plan_display` label, then to `plan`, then to `"Free"`, so a missing or legacy response never renders `Plan: undefined`.

## 1.5.1

### Patch Changes

- [`a3b9987`](https://github.com/mainahq/maina/commit/a3b998714aef2e7ca8afed78a6bf2afe2f146553) Thanks [@beeeku](https://github.com/beeeku)! - fix(feedback): drop auto-generated PR-summary comments during ingest

  `maina feedback ingest` now skips comments whose body starts with one of CodeRabbit's auto-generated summary HTML markers:

  - `<!-- This is an auto-generated comment: summarize by coderabbit.ai -->`
  - `<!-- This is an auto-generated comment: review in progress by coderabbit.ai -->`
  - `<!-- This is an auto-generated comment: skip review by coderabbit.ai -->`

  These issue-level boilerplate comments carry no actionable signal but were being categorised as `security` because their body contains words the keyword classifier picked up — they were dragging the unfiltered categorisation accuracy from ~9/10 down by adding ~10 false-positive `security` rows per session.

  Real review comments that merely _mention_ "auto-generated" (e.g. discussing a rule that fires on generated code) are unaffected — the marker must appear at the start of the body. New `isAutoSummaryComment(body)` helper is exported so other consumers can run the same filter.

  Locked in by 5 new `isAutoSummaryComment` unit tests (each known marker, leading-whitespace tolerance, prose-mention rejection, unrelated HTML rejection, empty/whitespace-only body) + one end-to-end ingest test that verifies a summary boilerplate and a real review comment from the same reviewer ingest as `(skipped: 1, ingested: 1)`.

## 1.5.0

### Minor Changes

- [#187](https://github.com/mainahq/maina/pull/187) [`9d5e2a7`](https://github.com/mainahq/maina/commit/9d5e2a769c232c02452e38f3da4d7cc9bca2066b) Thanks [@beeeku](https://github.com/beeeku)! - feat(verify): add doc-claims tool that catches fabricated API signatures in markdown

  New built-in verify tool that runs on changed `.md` / `.mdx` files. It parses
  fenced code blocks for `import` / `require` statements, resolves the module to
  the corresponding workspace package source, and emits a warning when a claimed
  symbol is not actually exported.

  Motivated by issue [#180](https://github.com/mainahq/maina/issues/180): a subagent asked to summarize a package's public API
  returned a narrative that mixed real exports with plausible-looking
  fabrications, and the fabrications shipped to docs (workkit#43, 20+ wrong API
  claims caught only by Copilot post-merge). This gate catches that class of
  slop before the docs ever land.

  v1 is mechanical (no LLM), diff-only, and intentionally scoped: external
  packages are skipped (no `node_modules` walk), member-access claims are not
  validated (requires type info), and `export *` re-exports are treated as
  wildcards. Severity is `warning` so users can tune via the noisy-rules
  preference before promoting to `error` in their constitution.

- [`46bcbc6`](https://github.com/mainahq/maina/commit/46bcbc69f2870c43d92ed3c3a4506491a2129468) Thanks [@beeeku](https://github.com/beeeku)! - feat(core,cli): ingest external code-review findings as labeled training signal (issue [#185](https://github.com/mainahq/maina/issues/185))

  Adds `maina feedback ingest` plus a new `external_review_findings` table in `.maina/feedback.db`. Pulls review comments from configured reviewers (`copilot-pull-request-reviewer`, `coderabbitai`, plus any `--reviewer <login>`) on open + recently merged PRs and stores them with file/line, reviewer kind, a heuristic category (`api-mismatch`, `signature-drift`, `dead-code`, `security`, `style`, `other`), and the diff hunk that was being reviewed.

  **Why:** across the v1.4.x dogfood loop Copilot caught 30+ accuracy bugs in PRs that `maina commit` had blessed (wrong export names, signature drift, claims about API shape that the source contradicts). Each finding is a **labeled `(input, output)` pair** — input is the diff Maina blessed, output is the bug a reviewer caught. Treating those as training data is more valuable than any hand-coded rule.

  **This is the v1 thin slice:**

  - `external_review_findings` schema + indexes on `(file_path)` and `(pr_repo, pr_number)`, idempotent on `(pr_repo, pr_number, source_id)`.
  - `ingestComments` / `ingestPrReviews` / `insertFinding` / `queryFindings` / `getTopCategoriesByFile` in `@mainahq/core`.
  - Deterministic keyword categoriser (no LLM in the hot path — `other` when nothing matches).
  - `maina feedback ingest [--repo <slug>] [--pr <n>] [--since <days>] [--reviewer <login>] [--json]`.
  - `maina stats` surfaces a "Top external-review categories" section once the table has data.
  - 20 new tests covering categorisation, dedupe, allow-list filtering, DB round-trip, and aggregation.

  **Out of scope (v2):**

  - The RL closure (`maina commit` consults the DB during verify and warns on touched files with prior findings)
  - Per-project policy training (`maina feedback train`)
  - Slop ruleset evolution from accumulated findings
  - LLM-backed reclassification of the `other` bucket
  - Cloud sync of findings

  Storage is **local only** today.

## 1.4.3

### Patch Changes

- [`40de5da`](https://github.com/mainahq/maina/commit/40de5daca11d43e2186a03bd47fc4ab56b0386ab) Thanks [@beeeku](https://github.com/beeeku)! - fix(mcp): prefer installed maina binary over bunx (avoids cold-start cache races)

  `maina mcp add` now writes the **direct path to the installed `maina` binary** when one is on PATH (e.g. `/Users/x/.bun/bin/maina --mcp`), falling back to `bunx`/`npx` only when the global install is absent.

  **Why:** real Cursor MCP logs against the v1.4.2 entry showed:

  ```
  [error] Resolved, downloaded and extracted [24]
  [error] Unexpected: failed copying files from cache to destination for package drizzle-orm
  [warning] Connection failed: MCP error -32000: Connection closed
  ```

  The previous default — `bunx @mainahq/cli` on every spawn — re-resolved the package each time Cursor (re)connected. Concurrent connection attempts during editor restart raced on `~/.bun/install/cache` and one would error mid-extraction, killing the spawned process before it could complete the MCP handshake. Going through the installed binary path skips the package manager entirely: zero downloads, zero cache, zero race.

  **Fallback chain (each tier resolves to absolute path via `Bun.which`):**

  1. **`maina` binary** — preferred. No package manager spawn.
  2. **`bunx @mainahq/cli@<version> --mcp`** — version-pinned so the bunx cache hits reliably across spawns even on cold start.
  3. **`npx @mainahq/cli@<version> --mcp`** — universally available fallback.
  4. Bare `npx` last-resort fallback so the entry stays syntactically valid on machines without Bun or Node.

  When `mcp add` falls back to a package-manager invocation (no global install present), the CLI prints a one-line tip pointing at `bun install -g @mainahq/cli` so users can opt into the fastest path.

  5 new launcher tests lock in the priority order and the absolute-path contract. All existing apply tests continue to pass under the version-pinned shape.

## 1.4.2

### Patch Changes

- [`19b5119`](https://github.com/mainahq/maina/commit/19b511924e5aaf3ee9c5782a7897b045c1cf5311) Thanks [@beeeku](https://github.com/beeeku)! - fix(mcp): write absolute launcher path so Cursor / Zed can spawn it

  `maina mcp add` now writes the **resolved absolute path** of `bunx` / `npx` (e.g. `/opt/homebrew/bin/bunx`) into client configs, instead of the bare binary name.

  **Why:** GUI-launched AI clients on macOS (Cursor, Zed, Claude Code app) inherit a stripped PATH that does NOT include `/opt/homebrew/bin` or `~/.bun/bin`. A bare `command: "bunx"` therefore fails with `Connection failed: spawn bunx ENOENT` — even though the binary is installed for the user. Surfaced from real Cursor logs against an entry written by v1.4.1.

  The detector now probes both `bunx` and `npx` via `Bun.which`, prefers the absolute `bunx` path when available, falls back to absolute `npx`, and only emits a bare name as a last-resort fallback when neither resolves on the install machine.

  Five new launcher tests lock in the absolute-path contract and the prefer-bunx-over-npx priority. Existing apply tests still pin to the bare `npx` fallback for snapshot stability.

  This is a strict bug fix on top of v1.4.1 — same `maina mcp add` interface, just produces working entries on real machines.

## 1.4.1

### Patch Changes

- [`a6f425c`](https://github.com/mainahq/maina/commit/a6f425c6fc9a70135dfef76b0c4f44ca863cb756) Thanks [@beeeku](https://github.com/beeeku)! - fix(mcp): auto-prefer `bunx` over `npx` when Bun is installed

  `maina mcp add` now detects whether [Bun](https://bun.sh) is on the user's PATH at install time and writes `bunx @mainahq/cli --mcp` (5-10× faster startup) when it is, falling back to `npx @mainahq/cli --mcp` (universally available via npm) otherwise.

  Surfaced from real-world dogfooding: a developer's existing entries used `bunx` (faster on their machine), and the v1.4.0 hard-coded `npx` would have regressed their config. Detection at install time fixes this without forcing a launcher choice on users who don't have Bun.

  Implementation:

  - New `packages/core/src/mcp/launcher.ts` with `detectLauncher({ which?, noCache? })` — single-shot `which("bunx")` probe with cache and a test-injectable lookup.
  - `entry.ts` and every client's `buildEntry` (including the wrapper shapes for Continue and Zed) now call the detector.
  - Existing apply tests pin the launcher to `npx` in `beforeEach` so assertions stay stable across CI (no Bun) and developer machines (has Bun). 6 new launcher tests cover detection, fallback, caching, and reset.

## 1.4.0

### Minor Changes

- [`1b3741c`](https://github.com/mainahq/maina/commit/1b3741c78b96795077b446a65751f47fab24cfbf) Thanks [@beeeku](https://github.com/beeeku)! - feat(cli): `maina mcp add/remove/list` across 8 AI clients

  Adds three new top-level commands inspired by `npx @posthog/wizard mcp add`:

  - `maina mcp add` — install the maina MCP server in every detected client's global config
  - `maina mcp remove` — strip the maina entry from every client
  - `maina mcp list` — show install status per client

  Supported clients: **Claude Code, Cursor, Windsurf, Cline, OpenAI Codex CLI, Continue.dev, Gemini CLI, Zed**. Each client's config — JSON for seven of them, TOML for Codex — is parsed, mutated only at the maina entry, and atomically rewritten so all other MCP servers and unrelated config keys are preserved.

  Flags (all subcommands): `--client <list>` (comma-separated; default: auto-detect), `--scope global|project|both` (default: `global`), `--dry-run`, `--json`.

  This is the cross-project counterpart to the setup wizard's per-project install — `maina setup` continues to write `.mcp.json` and `.claude/settings.json` for the current repo, while `maina mcp add` reaches every project at once.

  The Continue.dev integration uses the legacy `~/.continue/config.json#experimental.modelContextProtocolServers` shape; the newer per-server YAML files at `~/.continue/.continue/mcpServers/*.yaml` will land when YAML support is added (tracked as a follow-up).

## 1.3.0

### Minor Changes

- [`4fcf247`](https://github.com/mainahq/maina/commit/4fcf2479cf316403126a13668ee7f1ba1c18de64) Thanks [@beeeku](https://github.com/beeeku)! - feat(cli): zero-friction setup wizard

  Adds `maina setup`, a one-command onboarding wizard that detects your stack,
  tailors a constitution via host-delegated or cloud AI (anonymous, no API key),
  scaffolds 5 agent instruction files with non-destructive managed regions,
  seeds the codebase wiki, and runs verify to surface a real finding inline —
  all in under 60 seconds.

  - `--ci` mode emits per-phase JSON for automation
  - `--update` re-tailors constitution + agent files for the current stack
  - `--reset` backs up `.maina/` and starts fresh
  - `--agents <list>` scopes which agent files are written
  - `maina configure` is now a deprecated alias for `setup --update` (removed in v1.5)

  Docs: new `getting-started.mdx` features the wizard as the primary CTA. The
  previous `quickstart` page redirects to `/getting-started`. `full-setup` is
  demoted under "Advanced" as the long-form reference. Landing-page hero and
  root `README.md` now lead with `bunx @mainahq/cli@latest setup`.

## 1.2.1

### Patch Changes

- [`b9c7c2e`](https://github.com/mainahq/maina/commit/b9c7c2e18faa4e08804b780ff7fcd242a4d0873c) Thanks [@beeeku](https://github.com/beeeku)! - fix(core): `maina ticket` warns and skips missing labels instead of aborting ([#170](https://github.com/mainahq/maina/issues/170))

  Previously, inferred labels that didn't exist on the target repo would abort `gh issue create` one at a time, forcing users into whack-a-mole. `createTicket` now pre-fetches the repo's labels via `gh label list`, drops any that don't exist, and files the issue with the remainder. Skipped labels are surfaced via `skippedLabels` on the result and the CLI prints a `log.warning`. Pass `--strict-labels` to restore the old abort-on-missing behavior.

## 1.2.0

### Minor Changes

- v1.2.0 — 50 issues shipped across 6 milestones:

  **Init & Wiki fixes:**

  - CI workflow uses actual package.json script names and `maina verify`
  - Constitution architecture enriched for monorepos (workspace layout, package names)
  - Wiki reads descriptions from package.json, modules use meaningful names (not cluster-N)
  - MCP getContext output capped at 50K chars to prevent token limit errors
  - MCP responses use `{ data, error, meta }` envelope
  - Builtin secret checker skips test files and test fixture values

  **Onboarding:**

  - New /quickstart page (3 commands, under 60 seconds)
  - MCP install badges for Claude Code, Cursor, Windsurf on hero
  - Build-time stats generator (single source of truth for docs numbers)
  - 5 cookbook pages (CI verify, Claude Code, CodeRabbit, constitution check, Playwright MCP)
  - 4 blog posts (no SDK, no Passmark, no custom search, wiki-is-a-view)

  **Constitution rebuild (derived, not authored):**

  - Import adapters for existing rule files (CLAUDE.md, AGENTS.md, .cursorrules, etc.)
  - Git-log + CI analyzer (commit conventions, hot paths, CI workflows, CODEOWNERS)
  - Lint-config + manifest parsers (biome, eslint, tsconfig, editorconfig, prettier, package.json)
  - Pattern sampler (async style, function style, import style, error handling)
  - Glob-scoped constitution rules via constitution.d/\*.md
  - Interview gap-filler with rejected rules persistence

  **PR comment v2:**

  - Sticky root-comment writer (find-or-create via marker, race-safe)
  - GitHub Checks API integration (success/failure/neutral, annotations, merge gating)
  - Slash command parser (/maina retry, explain, approve)

  **Error reporting & telemetry:**

  - PII and code-content scrubbing library (paths, secrets, emails, IPs, env values)
  - Error ID generation (deterministic 6-char IDs, CLI + MCP surfaces)
  - OSS error reporting (opt-in, consent-gated, PostHog-ready)
  - Cloud error reporting (opt-out, account-linked, user_id/org_id/plan_tier)
  - Usage telemetry (separate consent, anonymous events)

  **MCP & Wiki:**

  - Progressive tool disclosure (list_tools meta-tool, 14 total tools)
  - DeepWiki-compatible MCP server (ask_question, read_wiki_structure, read_wiki_contents)
  - Symbol page templates with Mermaid call graphs + LLM prose
  - SCIP TypeScript ingest (subprocess runner, JSON parser, monorepo tsconfig discovery)
  - Wiki repositioned as "a view of the Context engine"

  **CI & Infra:**

  - Source map generation + release artifact upload
  - Dep bumps (biome 2.4.12, bun-types 1.3.12, knip 6.4.1, lefthook 2.1.6, vite 8.0.8)

  **ADRs:** 17 architecture decision records (0013-0029)

## 1.1.5

### Patch Changes

- [#84](https://github.com/mainahq/maina/pull/84) [`4ba53e6`](https://github.com/mainahq/maina/commit/4ba53e64e688ea1e6e53149211d9b285bfcfe126) Thanks [@beeeku](https://github.com/beeeku)! - Fix init, wiki, and MCP issues:

  - fix(core): CI workflow template uses actual package.json script names instead of hardcoded `bun run check` ([#79](https://github.com/mainahq/maina/issues/79))
  - feat(core): CI workflow uses `maina verify` with cloud and fallback options ([#82](https://github.com/mainahq/maina/issues/82))
  - feat(core): constitution architecture section includes workspace layout, package names, and project description for monorepos ([#83](https://github.com/mainahq/maina/issues/83))
  - fix(core): wiki architecture article reads descriptions from package.json with README fallback instead of hardcoded dictionary ([#81](https://github.com/mainahq/maina/issues/81))
  - fix(core): wiki module articles use meaningful names derived from file paths instead of generic cluster-N ([#80](https://github.com/mainahq/maina/issues/80))
  - fix(mcp): cap getContext output at 50K characters and use focused budget to prevent MCP token limit errors

## 1.1.3

### Patch Changes

- [`f94987f`](https://github.com/mainahq/maina/commit/f94987f6bbc490c37f64f8dc66240319e63ffcb6) Thanks [@beeeku](https://github.com/beeeku)! - Fix MCP server inside Claude Code: suppress all delegation output in MCP server mode via MAINA_MCP_SERVER env flag. Prevents stderr pollution that breaks MCP JSON-RPC communication.

## 1.1.2

### Patch Changes

- [`10649d3`](https://github.com/mainahq/maina/commit/10649d3733a38a1530ff3a2eb09a6123455fe84d) Thanks [@beeeku](https://github.com/beeeku)! - Post-release fixes: Orama search, wiki-aware commands, 12-tool support, install script, delegation output suppression, cloud sync fix, non-interactive mode.

## 1.1.1

### Patch Changes

- [#73](https://github.com/mainahq/maina/pull/73) [`331c58d`](https://github.com/mainahq/maina/commit/331c58d6287658934d8b434dffa5fab88a6db06e) Thanks [@beeeku](https://github.com/beeeku)! - Post-release fixes: MCP stdout fix, 12-tool support, install script, CI test fixes, docs updates.

## 1.1.0

### Minor Changes

- [`95e8d0b`](https://github.com/mainahq/maina/commit/95e8d0b47a94e3e9a4775b00afbb114c9a6740ae) Thanks [@beeeku](https://github.com/beeeku)! - Connect MCP tool results to cache and feedback systems (round-trip flywheel). Every MCP tool call now feeds into cache for instant replay, feedback for prompt evolution, and stats for dashboard tracking. Adds implicit accept/reject signals from commit success and tool re-runs.

- [`3ae23de`](https://github.com/mainahq/maina/commit/3ae23de520dcfe6c75b5ffbe70d11af87c40ec99) Thanks [@beeeku](https://github.com/beeeku)! - Wiki: Codebase Knowledge Compiler (v1.2.0)

  Adds a persistent, compounding knowledge layer that compiles code, plans, specs, ADRs, and workflow traces into interlinked wiki articles.

  **New Commands:** `wiki init`, `wiki compile`, `wiki query`, `wiki status`, `wiki lint`, `wiki ingest`, `setup`

  **New MCP Tools:** `wikiQuery`, `wikiStatus` (10 total)

  **Core Features:**

  - Knowledge graph with 11 edge types, Louvain community detection, PageRank scoring
  - Template-based + optional LLM compilation (`--ai` flag)
  - Context Engine Layer 5 (12% token budget) — wiki loaded automatically into every AI call
  - 9 wiki lint checks including spec drift, decision violations, missing rationale, contradictions
  - RL signals: Ebbinghaus decay with type-specific half-lives, prompt effectiveness tracking
  - Post-commit incremental compilation hook
  - Workflow wiki_refs tracking

  **Integration:**

  - `doctor` shows wiki health + MCP configuration status
  - `pr` includes wiki coverage delta
  - `stats` shows wiki metrics
  - `explain` draws from wiki with `--save` support
  - `learn` shows wiki effectiveness report
  - Verify pipeline includes wiki-lint (12+ tools)

  **Onboarding Fixes:**

  - Fixed MCP stdout corruption (delegation → stderr)
  - `.mcp.json` uses `bunx`/`npx` instead of bare `maina`
  - Auto-generates `.claude/settings.json` for Claude Code MCP discovery
  - Updated CLAUDE.md, AGENTS.md, GEMINI.md, .cursorrules with all 38+ commands
  - New `maina setup` guided onboarding with environment detection

## 1.0.3

### Patch Changes

- Graceful AI failure messages, built-in verify checks (7 checks without external linters), merge maina sections into existing agent files, and AI status in maina doctor.

## 1.0.2

### Patch Changes

- Enrich constitution generation with project context: package.json scripts, build tool, monorepo detection, conventions (commitlint, strict TS, CI, Docker, git hooks), and verification commands.

## 1.0.1

### Patch Changes

- [`f96460e`](https://github.com/mainahq/maina/commit/f96460ecf95ca9ac84038c0713d65604956e82a2) Thanks [@beeeku](https://github.com/beeeku)! - AI-driven interactive init with API key setup, project-aware tool detection, MCP/agent file generation, landing page light mode, and Mermaid workflow diagrams.

## 1.0.0

### Major Changes

- v1.0.0: Production release. Org migration to mainahq, community infrastructure (CONTRIBUTING.md, issue templates, CODEOWNERS), brainstorm --no-interactive fix, Show HN launch.

## 0.7.0

### Minor Changes

- v0.7.0: RL flywheel — daily audit workflow, cloud feedback endpoints, `maina learn --cloud`, feedback sync module. Adds `postFeedbackBatch` and `getFeedbackImprovements` to CloudClient.

## 0.6.0

### Minor Changes

- [#53](https://github.com/beeeku/maina/pull/53) [`af6294a`](https://github.com/beeeku/maina/commit/af6294a394d35cac71853787028457b1858e01e9) Thanks [@beeeku](https://github.com/beeeku)! - v0.6.0 cloud verification

  - Cloud verification via `--cloud` flag for offloading verify runs
  - Shared type exports between CLI and core packages
  - Cloud client methods: submitVerify, getVerifyStatus, getVerifyResult
  - Default cloud URL updated to api.mainahq.com
  - Fixed snake_case API response mapping to camelCase types

## 0.5.0

### Minor Changes

- [`c978eff`](https://github.com/beeeku/maina/commit/c978eff517e566a02bb27aa2190f8bceb77bfa7e) Thanks [@beeeku](https://github.com/beeeku)! - v0.5.0 release

  - Built-in typecheck, consistency check, 0-tools warning, Biome auto-config
  - --json flag on all commands, exit codes, GitHub Action
  - PHP support, per-file language detection, ZAP DAST, Lighthouse
  - Cloud API client, OAuth device flow, team sync, cross-repo ticketing
  - Post-workflow RL trace analysis, --auto flags

## 0.4.0

### Minor Changes

- v0.5.0 — Cloud client, built-in verify, PHP, ZAP, Lighthouse, --json, GitHub Action

  **v0.3.x Hardening:**

  - Built-in typecheck (tsc --noEmit) and cross-function consistency check in verify
  - 0-tools warning, Biome auto-config in maina init
  - --auto flags for maina spec and maina design
  - Post-workflow RL trace analysis

  **v0.4.0 Polish + CI:**

  - --json flag on all commands with exit codes (0/1/2/3)
  - mainahq/verify-action GitHub Action
  - PHP language profile (PHPStan, Psalm)
  - Per-file language detection for polyglot repos
  - ZAP DAST and Lighthouse integration

  **v0.5.0 Cloud Client:**

  - Cloud API client with auth, retries, Result<T, E>
  - maina login/logout (GitHub OAuth device flow)
  - maina sync push/pull (team prompt sync)
  - maina team (team management)
  - Cross-repo ticketing with maina ticket --repo

## 0.3.0

### Minor Changes

- [`e5a82ae`](https://github.com/beeeku/maina/commit/e5a82aedb0fb61d95758d5465c424a8cff3e9e8e) Thanks [@beeeku](https://github.com/beeeku)! - v0.3.0 — AI delegation, brainstorm command, enterprise languages.

  - Structured AI delegation protocol (`---MAINA_AI_REQUEST---`) for Claude Code, Codex, OpenCode
  - `maina brainstorm` — interactive idea exploration that generates structured GitHub issues
  - C#/.NET support — dotnet format, .sln/.csproj detection
  - Java/Kotlin support — Checkstyle, pom.xml/build.gradle detection
  - 6 languages, 16 tools, 25 commands, 1017+ tests

## 0.2.0

### Minor Changes

- [`59fcf84`](https://github.com/beeeku/maina/commit/59fcf844638af24ef25e849712397ff5b4b69095) Thanks [@beeeku](https://github.com/beeeku)! - Initial release of Maina — verification-first developer OS.

  - 24 CLI commands, 8 MCP tools, 5 cross-platform skills
  - 12-tool verify pipeline (Biome, Semgrep, Trivy, Secretlint, SonarQube, Stryker, diff-cover, AI review, slop detection, visual regression)
  - Multi-language support: TypeScript, Python, Go, Rust
  - Context Engine: 4-layer retrieval with PageRank relevance
  - Prompt Engine: constitution + A/B testing + feedback-driven evolution
  - Workflow context forwarding between lifecycle steps
  - Background RL feedback with post-workflow self-improvement loop
  - Visual verification with Playwright screenshots
  - Unified host delegation for Claude Code, Codex, OpenCode
  - Verification proof artifacts in PR body
  - 990 tests
