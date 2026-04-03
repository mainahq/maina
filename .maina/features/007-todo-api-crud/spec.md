# Feature: Todo API CRUD

## Problem Statement

The maina example project at `examples/todo-api/` is an empty scaffold (`console.log("Hello via Bun!")`). A working API example is needed to showcase maina's end-to-end workflow: spec → plan → TDD → verify → review → commit → learn → prompt evolution.

## Target User

- Developer evaluating maina who wants to see the full workflow in action
- Contributor who needs a reference for how maina dogfoods on real code

## User Stories

- As a developer, I want a working todo API example so I can run maina's full pipeline against real code
- As an evaluator, I want to see maina catch real issues (slop, validation gaps, spec violations) on a concrete project

## Success Criteria

- [ ] Server starts and responds to GET /todos with empty array
- [ ] Full CRUD lifecycle works: create → read → update → delete
- [ ] Invalid input returns 400 with descriptive error message
- [ ] Missing resource returns 404 with error in response envelope
- [ ] Response envelope matches `{ data, error, meta }` pattern
- [ ] All tests pass with bun:test
- [ ] No console.log in production code

## Scope

### In Scope

- HTTP server with JSON CRUD endpoints for todos
- Persistent storage across server restarts
- Input validation and error handling
- Integration tests covering all endpoints

### Out of Scope

- Authentication or authorization
- Pagination or filtering
- Frontend UI
