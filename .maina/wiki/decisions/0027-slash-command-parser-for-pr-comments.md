# Decision: Slash command parser for PR comments

> Status: **accepted**

## Context

Users want to interact with Maina from PR comments (`/maina retry`, `/maina explain`, `/maina approve`). The parser needs to be a pure function in core — the webhook handler in maina-cloud delegates to it.

## Decision

Regex-based parser: `/maina <command> [args]`. Returns typed `SlashCommand` or null. ACL helper checks PR author + write permission. No GitHub API calls in the parser — pure function.

## Rationale

### Positive
- Parser is testable and reusable (core, not cloud-specific)
- Webhook handler stays thin (parse → validate → dispatch)

### Negative
- Regex parsing can't handle complex arguments (acceptable — commands are simple)
