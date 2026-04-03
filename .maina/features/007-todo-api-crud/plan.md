# Implementation Plan

> HOW only — see spec.md for WHAT and WHY.

## Architecture

- Pattern: Bun.serve() HTTP server with bun:sqlite storage
- Response envelope: `{ data, error, meta }` per maina conventions
- All DB access through repository layer, no thrown exceptions

## Key Technical Decisions

- bun:sqlite for persistence (zero dependencies, fast)
- Bun.serve() routes for HTTP handling (no framework)
- Lazy DB initialization (create table on first access)

## Files

| File | Purpose | New/Modified |
|------|---------|-------------|
| examples/todo-api/src/db.ts | SQLite database setup | New |
| examples/todo-api/src/response.ts | Response envelope helpers | New |
| examples/todo-api/src/repo.ts | Todo repository (CRUD operations) | New |
| examples/todo-api/src/routes.ts | Route handlers with validation | New |
| examples/todo-api/index.ts | Bun.serve() entrypoint | Modified |
| examples/todo-api/src/index.test.ts | Integration tests | New |

## Tasks

- [ ] T001: Set up SQLite database module with lazy-init and todos table
- [ ] T002: Create response envelope helpers (ok, err) matching { data, error, meta }
- [ ] T003: Implement todo repository with list, get, create, update, delete
- [ ] T004: Implement route handlers with input validation
- [ ] T005: Wire up Bun.serve() entrypoint with routes and configurable port
- [ ] T006: Write integration tests covering CRUD lifecycle, validation, and 404s

## Failure Modes

- Invalid JSON body → 400 with parse error message
- Missing title → 400 with "title is required"
- Non-integer ID → 400 with "invalid id"
- Todo not found → 404 with "todo not found"
- DB error → 500 with generic error (no internals leaked)

## Testing Strategy

- Integration tests via fetch against running server
- Happy path: full CRUD lifecycle
- Validation: empty title, missing body, invalid ID
- Not found: GET/PATCH/DELETE on non-existent ID
- Response shape: all responses match envelope pattern
