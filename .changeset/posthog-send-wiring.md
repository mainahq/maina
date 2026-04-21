---
"@mainahq/core": minor
"@mainahq/cli": minor
---

**PostHog send path wired end-to-end (feat 054).** Event builders (`buildUsageEvent`, `buildErrorEvent`) and PII scrubbing have existed for months without a caller — users who opted in to `telemetry: true` still sent zero events.

This PR adds `packages/core/src/telemetry/posthog-client.ts` with `captureUsage`, `captureError`, and `flushTelemetry`. All three are no-ops unless (a) the consent flag in `~/.maina/config.yml` is set AND (b) `MAINA_POSTHOG_API_KEY` is present at build time. OSS forks built without the key get a silent no-op binary — no leaked events to maina's PostHog project.

Wired three high-value call sites: `maina setup` emits `maina.install`, `maina verify` emits `maina.verify.started` + `maina.verify.completed`, `maina learn` emits `maina.learn.ran`. The remaining five events enumerated in `UsageEventName` (`maina.commit`, `maina.plan`, `maina.wiki.init`, `maina.wiki.query`) land in a follow-up so this PR stays reviewable.

Commander `postAction` hook awaits `flushTelemetry(2000)` at every command exit so an unreachable PostHog endpoint cannot hang `maina commit` beyond the budget. The SDK is dynamic-imported on the first green-lit capture — startup cost is zero when telemetry is off.
