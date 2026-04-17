# Feature: PII and code-content scrubbing library

## Problem Statement

Error reporting (PostHog) must never leak PII or code content. Both OSS and Cloud paths depend on a client-side scrubber that runs before any network send.

## Success Criteria

- [x] Redacts: absolute file paths, code snippets in stack frames, env variable values, usernames/emails/IPs, API keys/tokens, repo names, commit messages, branch names
- [x] Keeps: error class, scrubbed message, stack trace structure/line numbers/function names, OS/Maina version
- [x] 20+ adversarial unit tests (leaked keys, user paths, code snippets)
- [x] Runs on client, pure function, no side effects

## Scope

### In Scope
- `scrubPii(text)` — general text scrubber
- `scrubStackTrace(stack)` — stack-trace-specific scrubber
- `scrubErrorEvent(event)` — full event scrubber for PostHog/Sentry payloads

### Out of Scope
- Server-side scrubbing (client-only by design)
- Fuzz testing (future enhancement)
