# Feature 054: Wire PostHog send path

**Issue:** https://github.com/mainahq/maina/issues/222

## Problem Statement

Users who opt in to telemetry via `~/.maina/config.yml` (`telemetry: true`) currently send **zero** events. The telemetry module scaffolds event shapes (`UsageEventName` enumerates eight events), PII scrubbing (`scrubber.ts`), and PostHog-compatible envelopes — but nothing ever calls `buildUsageEvent`, nothing sends HTTP, and `posthog-node` is not a dep. Comment in `reporter.ts:8` calls this out honestly: *"the actual send is handled by the caller (PostHog client or HTTP POST)"*. No caller exists.

This matters because:

- The RL flywheel vision (memory: `project_rl_flywheel_vision`) depends on daily usage data reaching PostHog EU; today that channel is dark.
- The cloud-landing page tells users "data sits in PostHog EU" (`docs/src/data/cloud-landing.ts:133`) — true-in-intent, false-in-fact.
- Users who explicitly opt in to help improve the tool produce **zero signal**. That's worse than telling them telemetry doesn't exist, because they expect events are flowing.

## Target User

- **Primary:** Bikash running `maina learn` and expecting dashboards downstream. Today the local `learn` works, cloud-sync works, PostHog is the missing piece for cohort-level metrics.
- **Secondary:** OSS consumers on self-hosted forks who want to set `MAINA_POSTHOG_API_KEY` to their own project. Must work equivalently when the build-time key is absent (graceful no-op rather than silent failures with stack traces).

## User Stories

- As a maintainer, I want a user who opts in to `telemetry: true` to produce one PostHog event per command completion, so I can see command-mix shifts week over week.
- As an OSS consumer forking maina, I want the build to succeed without a PostHog API key and telemetry calls to no-op at runtime, so my fork doesn't leak events to maina's project.
- As a user with a slow or offline network, I want `maina commit` to not hang for 30 s because PostHog's ingest endpoint is unreachable.

## Success Criteria

Binary + test-enforced. Each maps to a test ID in `plan.md` §3.

- [ ] Default config (no `telemetry:` key, or `telemetry: false`) → zero PostHog HTTP calls. Stubbed transport that fails the test on invocation enforces this.
- [ ] `telemetry: true` at runtime AND `MAINA_POSTHOG_API_KEY` set at build → every wired call site emits one event, name matches `UsageEventName`, payload has PII scrubbed per `scrubber.ts` rules.
- [ ] `telemetry: true` at runtime BUT no build-time key → graceful no-op. CLI doesn't print warnings, doesn't slow down, doesn't throw.
- [ ] `posthog-node` lands as a runtime dep of `@mainahq/core` but is loaded via dynamic `import()` so startup cost is zero when telemetry is off.
- [ ] CLI exit awaits `flushTelemetry()` with a 2 s timeout. A 5 s artificial delay in the stubbed send does NOT delay process exit beyond 2 s.
- [ ] Error path (`errors: true`, uncaught exception) reaches `captureError()`. `errors: false` keeps error events off even when `telemetry: true`. The two consent flags stay independent.

## Scope

### In Scope (THIS PR)

- New `posthog-client.ts` with: consent gate, lazy SDK import, build-time key injection point, `captureUsage` / `captureError` / `flush`, queued-capture drain on shutdown.
- Call sites wired for **3 of 8** enumerated events in this PR — the highest-value commands:
  - `maina setup` → `maina.install` (honours `--no-telemetry` command-level flag)
  - `maina verify` → `maina.verify.started` + `maina.verify.completed` (both local and `--cloud` paths)
  - `maina learn` → `maina.learn.ran`
- CLI exit handler drain via `program.ts` — `postAction` hook + belt-and-braces `beforeExit`/`SIGINT`/`SIGTERM` so commands that call `process.exit()` directly also drain.
- Tests for the client: consent off, consent on + no key, consent on + key set, errors-consent independence, SDK construction error, flush budget.

### Deferred (follow-up PRs)

- Remaining 5 call sites: `maina.commit`, `maina.plan`, `maina.wiki.init`, `maina.wiki.query`. Each is ~5 lines + a small test; kept out of this PR to keep the review surface reasonable.
- Wiring `captureError()` into the existing CLI error-reporter path. Currently the builder is exported but the CLI crash path still routes to the legacy `cli-error-reporter` only.
- `posthog-node` as a hard dep of `@mainahq/core`. Currently dynamic-imported without the package listed, so OSS forks building without the dep get a no-op. Adding the dep to package.json is what actually lets real captures fire in prod.

### Out of Scope

- New event names beyond the eight in `UsageEventName`.
- Dashboard / admin surfaces (those live in `mainahq/maina-cloud`).
- Direct-HTTP fallback — if the PostHog SDK fails, we no-op; we do not re-implement ingestion.
- Self-hosted PostHog routing (env-overridable host is a trivial follow-up; not in this PR).
- Telemetry for internal / deferred-tool commands (analyze, cache, stats, sync, team, benchmark).
- Changing the existing `isTelemetryEnabled()` / `isErrorReportingEnabled()` config contracts.

## Design Decisions

- **Build-time key, not runtime config.** The PostHog project key is baked into the distributed binary via `bunup` env replacement (`MAINA_POSTHOG_API_KEY`). OSS forks that build without the var get a no-op binary — no leaked keys, no surprise events to maina's PostHog project. Alternative — runtime env var + `~/.maina/config.yml` key — rejected because it puts the opt-out burden on the fork maintainer and makes user-level telemetry opt-in more complex.
- **Dynamic SDK import.** `await import("posthog-node")` inside the first capture call, cached. Keeps the cold-start path off the SDK's 50 KB bundle when telemetry is off.
- **Two independent consent flags stay independent.** `telemetry: true` controls `maina.*` usage events; `errors: true` controls `maina.error` events. This matches the existing `usage.ts` + `reporter.ts` split; we don't collapse them.
- **Exit-drain budget of 2 s.** Short enough that a dead network doesn't hang `maina commit`; long enough that a healthy PostHog ingest (<300 ms typical) completes.
- **DI-injected SDK for tests.** `posthog-client.ts` accepts an optional `createPosthog` factory so tests can plug in a fake and assert on captured calls without touching the real SDK.

## Open Questions

None blocking. Noted for follow-up:

- Should we route to a self-hosted PostHog via `MAINA_POSTHOG_HOST` env? Trivial addition; deferred until someone asks.
- Should we track `maina review` / `maina pr` completion events? They're not in the current `UsageEventName`; scope-creeping this PR to add them would duplicate the design conversation. Add separately when the event names are ratified.
