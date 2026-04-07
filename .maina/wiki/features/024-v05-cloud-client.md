# Feature: Implementation Plan — v0.5.0 Cloud Client + maina-cloud

## Scope

### Cloud API Client (`packages/core/src/cloud/`) - `client.ts` — HTTP client for Maina Cloud API. Handles auth headers, retries, error envelopes. - `types.ts` — Shared request/response types. Used by both CLI and cloud. - `auth.ts` — GitHub OAuth device flow (client-side). Stores token in `~/.maina/auth.json`. ### CLI Commands - `maina login` — GitHub OAuth device flow. Opens browser, polls for token, stores locally. - `maina logout` — Removes stored credentials. - `maina sync push` — Uploads local prompts + feedback to cloud. - `maina sync pull` — Downloads team prompts, merges with local. - `maina team` — Shows team members, roles, prompt sync status. ### Config - `maina configure` gains cloud section: API URL, team ID. - Default API URL: `https://api.mainahq.com` (configurable for self-hosted). ### Scaffold at `mainahq/maina-cloud` (private repo) - Bun + Workkit + Cloudflare Workers project - Health check endpoint (`GET /health`) - Auth endpoint (`POST /auth/device`, `POST /auth/token`) - Prompt sync endpoints (`GET /prompts`, `PUT /prompts`) - Team endpoints (`GET /team`, `POST /team/invite`) - D1 schema: teams, members, prompts, feedback - CLAUDE.md with project conventions

## Status

- **Branch:** _none_
- **PR:** _none_
- **Merged:** no
