---
"@mainahq/core": major
"@mainahq/cli": patch
---

Telemetry, feedback and benchmark read their environment through an injected `EnvPort` instead of `process.env`. `buildErrorEvent`/`reportError` take `{ env }` in their context (host agent detection), `isCliTelemetryOptedOut(env)` and `sendCliErrorReport`/`buildCliErrorPayload` read opt-out flags, `HOME`, `CI` and `MAINA_CLOUD_URL` from `opts.env`, `createPosthogClient` requires `env` (API key, host, device fingerprint) and `captureUsage(event, env)`/`captureError(event, env)` take it too. `recordFeedbackAsync` and `recordFeedbackWithCompression` take a `FeedbackSyncContext` (`{ env, authDir? }`) for the cloud sync, and `runBenchmark` takes the child `env` explicitly. `getFeedbackDb` and the other DB openers now return a driver-neutral `DbHandle` (`SqliteDatabase`/`SqliteStatement` structural types, Drizzle typed via `drizzle-orm/sqlite-core`), so no public core type names a `bun:*` module; `query`/`prepare` are no longer generic, so narrow rows at the call site. The CLI passes its live process environment at the edge.
