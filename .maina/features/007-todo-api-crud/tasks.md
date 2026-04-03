# Task Breakdown

## Tasks

- [ ] T001: Set up SQLite database module with lazy-init and todos table
- [ ] T002: Create response envelope helpers (ok, err) matching { data, error, meta }
- [ ] T003: Implement todo repository with list, get, create, update, delete
- [ ] T004: Implement route handlers with input validation
- [ ] T005: Wire up Bun.serve() entrypoint with routes and configurable port
- [ ] T006: Write integration tests covering CRUD lifecycle, validation, and 404s

## Dependencies

- T003 depends on T001 (needs DB)
- T004 depends on T002, T003 (needs response helpers + repo)
- T005 depends on T004 (needs routes)
- T006 depends on T005 (needs running server)

## Definition of Done

- [ ] All tests pass
- [ ] maina verify passes
- [ ] maina checkSlop clean
- [ ] No console.log in production code
