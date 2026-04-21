# Feature 054: PostHog send-path wiring — Plan (HOW)

> HOW only — see `spec.md` for WHAT and WHY.

**Issue:** https://github.com/mainahq/maina/issues/222
**Convention:** TDD — test first, watch fail, implement, watch pass. `Result<T, E>`, no throws, no `console.log`.

## 1. Files

### New

- `packages/core/src/telemetry/posthog-client.ts` — the send seam.
- `packages/core/src/telemetry/__tests__/posthog-client.test.ts` — consent/key/flush tests.
- `packages/cli/src/commands/__tests__/{verify,setup,learn,commit,plan,wiki-init}.telemetry.test.ts` — one per call-site, uses DI'd fake capture.

### Modify

- `packages/core/package.json` — `posthog-node` dependency (^4.x).
- `packages/core/src/telemetry/index.ts` — barrel re-exports for the client.
- `packages/core/src/index.ts` — re-export `captureUsage`, `captureError`, `flushTelemetry`.
- `packages/cli/src/program.ts` — exit hook awaits `flushTelemetry()` with 2 s budget.
- `packages/cli/src/commands/setup.ts` — call `captureUsage(buildUsageEvent("maina.install", {...}))` on fresh-mode success.
- `packages/cli/src/commands/verify.ts` — `maina.verify.started` + `maina.verify.completed`.
- `packages/cli/src/commands/learn.ts` — `maina.learn.ran`.
- `packages/cli/src/commands/commit.ts` — `maina.commit`.
- `packages/cli/src/commands/plan.ts` — `maina.plan`.
- `packages/cli/src/commands/wiki/init.ts` — `maina.wiki.init`.
- `packages/cli/src/commands/wiki/query.ts` — `maina.wiki.query`.
- `packages/core/src/errors/cli-error-reporter.ts` — existing error path calls `captureError()`.
- `packages/cli/bunup.config.ts` — `define: { "process.env.MAINA_POSTHOG_API_KEY": JSON.stringify(process.env.MAINA_POSTHOG_API_KEY ?? "") }` so the build-time value is inlined.

## 2. `posthog-client.ts` contract

```ts
export interface PosthogClient {
  captureUsage(event: UsageEvent): void;
  captureError(event: ErrorEvent): void;
  flush(): Promise<void>;
}

export interface PosthogClientOptions {
  /** DI seam for tests. Defaults to dynamic-importing `posthog-node`. */
  createPosthog?: (apiKey: string) => PosthogLike;
  /** Override the build-inlined key (tests). */
  apiKeyOverride?: string;
  /** Override `isTelemetryEnabled` / `isErrorReportingEnabled` (tests). */
  consent?: { usage: boolean; errors: boolean };
  /** `process.nextTick`-ish override for deterministic tests. */
  nowMs?: () => number;
}

export function createPosthogClient(opts?: PosthogClientOptions): PosthogClient;

/** Process-wide singleton. Created on first access. Cached. */
export function captureUsage(event: UsageEvent): void;
export function captureError(event: ErrorEvent): void;
export function flushTelemetry(budgetMs?: number): Promise<void>;
```

Key properties:

- `captureUsage` / `captureError` are **synchronous fire-and-forget**. No promise returned to the caller so no command flow depends on the send.
- Consent is re-checked on every call (cheap — disk read is gated by process-memoisation in `usage.ts` / `reporter.ts`).
- If `apiKey` is empty → no-op. No SDK import.
- If consent off → no-op. No SDK import.
- SDK is loaded once (per process) on the first green-lit capture. Subsequent captures reuse.
- `flush(budget)` resolves when the PostHog SDK's `shutdown()` returns OR when `budget` elapses, whichever comes first. Never throws.

## 3. Tests

| ID | File | Asserts | Status |
|---|---|---|---|
| T1 | `posthog-client.test.ts — consent off` | captureUsage() → SDK never instantiated | ✅ shipped |
| T2 | `posthog-client.test.ts — consent on, no key` | captureUsage() → SDK never instantiated | ✅ shipped |
| T3 | `posthog-client.test.ts — consent on, key set` | captureUsage() → exactly 1 `capture()` on fake SDK | ✅ shipped |
| T4 | `posthog-client.test.ts — errors consent independent` | `telemetry: true, errors: false` → captureUsage fires, captureError no-ops | ✅ shipped |
| T5 | `posthog-client.test.ts — flush budget` | fake SDK `shutdown()` hangs 5 s, flush resolves within ~200 ms | ✅ shipped |
| T6 | `posthog-client.test.ts — no-op on SDK throw` | fake `createPosthog` throws on construct, captureUsage stays silent | ✅ shipped |
| T7–T12 | call-site telemetry tests | one per call site | ⏭️ deferred — see spec §Deferred |

Call-site coverage for this PR is demonstrated by existing `setup.test.ts`, `verify.test.ts`, and `learn.test.ts` continuing to pass with the new imports (the `@mainahq/core` mock in `verify.test.ts` was updated to export `buildUsageEvent` + `captureUsage` as no-ops). Dedicated `*.telemetry.test.ts` files are deferred with the rest of the event coverage.

## 4. Sequencing

1. T1–T6 red — write `posthog-client.ts` tests first.
2. Implement `posthog-client.ts` + barrel export.
3. T1–T6 green. Typecheck, biome, commit as checkpoint.
4. T7 red — add setup.ts capture, green.
5. Repeat T8 → T12 one at a time.
6. Wire `program.ts` exit drain. Add a small integration test: `maina verify` exits within 2.5 s when fake SDK hangs 5 s.
7. Update `.changeset/` entry (`@mainahq/core: minor, @mainahq/cli: minor`).
8. `maina verify` → MCP `reviewCode` + `checkSlop` → `maina commit` → `maina pr` to master.

## 5. Build-time key injection

Edit `packages/cli/bunup.config.ts`:

```ts
export default {
  define: {
    "process.env.MAINA_POSTHOG_API_KEY": JSON.stringify(
      process.env.MAINA_POSTHOG_API_KEY ?? "",
    ),
  },
  // ...
};
```

Runtime reads `process.env.MAINA_POSTHOG_API_KEY`. In a dev build (env unset), this inlines `""` → no-op path at runtime. In a prod build (CI sets the env), the real key is baked in. OSS forks building locally get a no-op binary — forks that want their own project just set the env var before `bun run build`.

## 6. Exit drain

`program.ts`:

```ts
program.hook("postAction", async () => {
  await flushTelemetry(2_000);
});
```

Commander's `postAction` hook fires after every command action completes. 2 s budget — enough for healthy PostHog ingest, short enough to not hang on dead networks. `flushTelemetry` itself uses `Promise.race([shutdown(), timeout])`.

## 7. What this plan does NOT change

- Existing `buildUsageEvent` / `buildErrorEvent` shapes — unchanged.
- `scrubber.ts` — already thorough; we trust its output.
- `UsageEventName` union — no new events.
- Consent config format in `~/.maina/config.yml` — unchanged.
- `maina learn --cloud` upload path (to `api.mainahq.com/feedback/*`) — orthogonal to PostHog; keeps working as-is.

## 8. Rollout

- Single PR, squash merge, behind no flag. Opt-in is already off by default (config must say `telemetry: true`).
- No migration. Users who want to send events edit `~/.maina/config.yml`; users who don't, don't.
- Changeset bumps both `@mainahq/core` and `@mainahq/cli` minor.

## 9. Budget

M — 2–3 days. Most of the effort is the 6 call-site test files + small refactors; the client itself is ~80 LOC with clear tests.
