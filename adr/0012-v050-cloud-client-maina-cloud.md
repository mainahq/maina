# 0012. v0.5.0 Cloud Client + maina-cloud

Date: 2026-04-05

## Status

Accepted

## Context

Maina is local-only. Teams need shared prompts, feedback, and A/B testing coordination. The cloud infrastructure must be private (business logic), while the CLI client stays open source.

## Decision

Split into two repos: open-source CLI client in mainahq/maina, private Workers service repo (mainahq/maina-cloud). Shared types ensure API contract consistency. GitHub OAuth device flow for auth. Workkit packages power the cloud service.

## Consequences

### Positive

- Cloud business logic stays private
- CLI client is open source — community can see how sync works
- Shared types prevent API drift
- Workkit dogfooding starts immediately

### Negative

- Two repos to maintain
- Shared types need manual sync (mitigated by shared types package later)
- OAuth device flow is more complex than simple API key

### Neutral

- Cloud repo is standard Cloudflare Workers project
- API client follows existing Result<T, E> pattern

## High-Level Design

### API Contract

```
POST /auth/device          → { device_code, user_code, verification_uri }
POST /auth/token           → { access_token, team_id }
GET  /health               → { status: "ok", version }
GET  /prompts              → { prompts: PromptRecord[] }
PUT  /prompts              → { updated: number }
GET  /team                 → { team: TeamInfo, members: Member[] }
POST /team/invite          → { invite_url }
POST /feedback             → { recorded: number }
```

### Auth Flow

```
maina login
  → POST /auth/device (get device_code + user_code)
  → Show user_code, open browser to verification_uri
  → Poll POST /auth/token until authorized
  → Store { access_token, team_id } in ~/.maina/auth.json
```

### Prompt Sync

```
maina sync push
  → Read .maina/prompts/*.md
  → PUT /prompts { prompts: [...] }
  → Server merges with team prompts (last-write-wins per prompt)

maina sync pull
  → GET /prompts
  → Write team prompts to .maina/prompts/
  → Local overrides preserved (marked in frontmatter)
```

## Low-Level Design

### Shared Types (packages/core/src/cloud/types.ts)

```typescript
export interface CloudConfig {
  apiUrl: string;
  teamId: string | null;
  token: string | null;
}

export interface PromptRecord {
  name: string;
  hash: string;
  content: string;
  updatedAt: string;
  author: string;
}

export interface TeamInfo {
  id: string;
  name: string;
  memberCount: number;
  promptCount: number;
}

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  meta?: Record<string, unknown>;
}
```

### Error Handling

- API client returns Result<T, E> — never throws
- Network errors → retry 3 times with exponential backoff
- 401 → prompt re-login
- Cloud service down → all commands degrade gracefully (local-only mode)
