# Feature: Lock docs numbers to a single source of truth

## Problem Statement

The site and docs disagree: 19+ vs 18+ tools, 38+ vs 28+ commands, 10 vs 8 MCP tools. For a verification tool, inconsistent numbers are a credibility problem.

## Success Criteria

- [ ] Numbers generated from code at build time
- [ ] Single `packages/docs/src/data/stats.json` read by docs pages and landing site
- [ ] Build script counts verify tools, CLI commands, MCP tools, and supported languages

## Scope

### In Scope
- Build script that counts from source
- stats.json output
- Landing page reads from stats.json

### Out of Scope
- CI check for hand-typed counts (future)
