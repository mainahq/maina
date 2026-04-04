# Feature 021: Structured AI Delegation Protocol

## Problem

When maina runs inside Claude Code/Codex/OpenCode, AI-dependent features are non-functional. The subprocess has CLAUDECODE=1 but no API key. `tryAIGenerate` returns a `DelegationPrompt` object but nobody processes it. Result: review at 47% accept rate (on echoed prompts), A/B test collecting no data, commit messages not AI-generated, HLD/LLD empty.

## Success Criteria

- **SC-1:** `tryAIGenerate` in host mode outputs `---MAINA_AI_REQUEST---` block to stdout
- **SC-2:** Protocol includes: task, context, prompt, expected_format, schema
- **SC-3:** Each CLI command that uses AI shows "delegated to host" status
- **SC-4:** Protocol is plain text — no IPC, no binary, works with any stdout reader
- **SC-5:** `formatDelegationRequest(delegation)` and `parseDelegationRequest(text)` are exported for host agents
- **SC-6:** MCP tools include delegation blocks in their response text
- **SC-7:** Existing direct API path (with MAINA_API_KEY) is unchanged

## Out of Scope

- Two-pass execution (request → process → feed back)
- Host agent implementation (each host handles the protocol its own way)
- Automatic AI result injection back into pipeline

## Design

### Protocol Format

```
---MAINA_AI_REQUEST---
task: ai-review
context: Reviewing diff for cross-function consistency and missing edge cases
prompt: |
  Review this diff for semantic issues:
  +const x = validateInput(data);
expected_format: json
schema: {"findings":[{"file":"path","line":42,"message":"desc","severity":"warning"}]}
---END_MAINA_AI_REQUEST---
```

### Module

New file: `packages/core/src/ai/delegation.ts`

```typescript
interface DelegationRequest {
  task: string;
  context: string;
  prompt: string;
  expectedFormat: "json" | "markdown" | "text";
  schema?: string;
}

function formatDelegationRequest(req: DelegationRequest): string
function parseDelegationRequest(text: string): DelegationRequest | null
function outputDelegationRequest(req: DelegationRequest): void  // writes to stdout
```

### Integration

`tryAIGenerate` calls `outputDelegationRequest` when in host mode. Each CLI command's output naturally includes the block. The host agent sees it in stdout/MCP response and acts on it.

## Files to Change

| File | Change |
|------|--------|
| `packages/core/src/ai/delegation.ts` | NEW — format, parse, output functions |
| `packages/core/src/ai/try-generate.ts` | Output delegation block in host mode |
| `packages/core/src/ai/__tests__/delegation.test.ts` | NEW — tests |
| `packages/core/src/index.ts` | Export delegation module |
| `packages/core/src/review/index.ts` | Show delegation status |
| `packages/core/src/verify/ai-review.ts` | Show delegation status |
