# Feature 034: v1.1.0 Round-Trip Flywheel

## Problem

In host mode (Claude Code/Cursor), AI calls are delegated to the host. Maina never sees the response, so cache and feedback are empty. After 83 commits: 0% cache hit rate, 0 prompt feedback entries, quality trending down. The RL loop — maina's core differentiator — has zero data.

## Root Cause

MCP tools return structured results to the host, but those results aren't fed back into maina's cache or feedback system. The flywheel is built but not connected.

## Design

### Flow Change

```
Before:
  MCP tool called → engine runs → result returned to host → gone

After:
  MCP tool called → engine runs → result returned to host
                                → captureResult(toolName, input, output)
                                    ├→ cache.set(key, output)
                                    ├→ feedback.record(promptHash, outcome)
                                    └→ stats.track(toolName, tokens, duration)
```

### Implicit Accept/Reject Signals

Infer outcomes from behavior instead of requiring explicit user action:
- `maina commit` succeeds after `reviewCode` → review accepted
- `maina verify` passes → verification accepted
- User re-runs same command after changes → previous result rejected
- `checkSlop` finds 0 issues → code was clean (accepted)

## Success Criteria

### SC-1: Result Capture
- New `captureResult()` function in `packages/core/src/feedback/capture.ts`
- Called by every MCP tool handler after returning results
- Captures: tool name, input hash, output, prompt hash (if AI involved), duration

### SC-2: Cache Population from MCP
- MCP results stored in cache with standard key: `hash(tool + inputHash + context)`
- Same file reviewed twice with no changes → cache returns instantly
- Cache hit rate should be > 0% after normal usage

### SC-3: Feedback from Implicit Signals
- `maina commit` success → records accept for prior review/verify results
- Re-run after changes → records reject for previous result
- Signals stored in feedback.db with prompt hash linkage

### SC-4: Stats Pipeline
- `maina stats` shows real data: accept rate, cache hits, quality trends
- `maina doctor` AI Status section shows feedback flowing
- Trends should show quality ↑ once flywheel is connected

### SC-5: Prompt Evolution Gets Data
- `maina learn` can analyze accept/reject patterns
- A/B testing has real traffic to measure
- Prompt versions track which version produced which outcomes

## Files

| Change | File |
|--------|------|
| New | `packages/core/src/feedback/capture.ts` — captureResult() function |
| New | `packages/core/src/feedback/signals.ts` — implicit accept/reject logic |
| Modify | `packages/mcp/src/server.ts` — wrap tool handlers with capture |
| Modify | `packages/cli/src/commands/commit.ts` — emit accept signal on success |
| Modify | `packages/core/src/cache/manager.ts` — support MCP result caching |
| Modify | `packages/core/src/stats/tracker.ts` — track MCP tool usage |

## Out of Scope
- Explicit accept/reject UI (implicit signals are sufficient for now)
- Cloud sync of feedback (that's v2)
- Custom model fine-tuning from feedback (that's v3)

## Dependencies
- v1.0.3 must ship first (doctor AI status, verify built-ins provide baseline)
