# 0021. Error ID surface for CLI and MCP

Date: 2026-04-17

## Status

Accepted

## Context

When maina crashes, users file issues saying "it didn't work" with no way to reference the specific error. Maintainers can't correlate reports with stack traces. We need a short, user-quotable error identifier that maps back to an event.

## Decision

Generate deterministic 6-char error IDs using DJB2 hash of `errorClass:errorMessage`, encoded in a base32 alphabet without ambiguous characters (O/0/I/l). Format: `ERR-<6chars>`.

**Deterministic fingerprinting** (same error = same ID) was chosen over unique event IDs because:
- Users quoting the same ID in different issues signals "this is the same bug"
- PostHog/Sentry backend assigns unique event IDs independently
- Fingerprinting enables dedup at the reporting layer

### Surfaces

- CLI stderr: `Error ERR-ab12cd. <message>\nReport at github.com/mainahq/maina/issues (include this ID).`
- MCP error responses: `{ "error": "...", "error_id": "ERR-ab12cd" }`
- PR comments (future): `Verification crashed. Error ID: ERR-ab12cd.`

### Implementation

- `generateErrorId(error)` — DJB2 hash → base32, pure function
- `formatErrorForCli(error)` — user-facing stderr output
- `formatErrorForMcp(error)` — structured `{ error, error_id }` response

## Consequences

### Positive

- Users can quote a short ID in issues for instant correlation
- Same error across users produces the same ID (dedup signal)
- No external dependency — DJB2 + base32 is <30 lines

### Negative

- Fingerprint-based: different stack traces for the same message get the same ID (acceptable — message is the primary grouping key)
- Not a unique event ID — PostHog assigns those independently
