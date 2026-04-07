---
name: tdd
description: Follow maina's test-driven development cycle from generated stubs through red-green-refactor.
triggers:
  - "write tests"
  - "test driven"
  - "tdd"
  - "test first"
  - "generate test stubs"
---

# Test-Driven Development

## When to use

When implementing any feature or fixing any bug. Maina enforces TDD as the default development practice: tests are written before implementation, and the plan analysis checks that test tasks precede implementation tasks.

## Steps

1. **Generate test stubs** with `maina spec` (or call the `suggestTests` MCP tool). This reads the current feature's plan.md and creates test files for each task, organized by test category.
2. **Five test categories** are generated for comprehensive coverage:
   - **Happy path:** The expected behavior works correctly with valid inputs.
   - **Edge cases:** Boundary values, empty inputs, maximum sizes, concurrent access.
   - **Error handling:** Invalid inputs return proper Result errors, not thrown exceptions.
   - **Security:** Authentication required, authorization enforced, inputs sanitized.
   - **Integration:** Components work together correctly across module boundaries.
3. **Red phase:** All generated stubs contain a deliberately failing assertion. Run the project's test runner and confirm every stub fails. If a stub passes, the test is not actually testing anything -- fix it.
4. **Green phase:** For each failing test, write the minimal implementation code needed to make it pass. Do not add features beyond what the test requires. Run the test runner after each change.
5. **Refactor phase:** Once all tests pass, clean up the implementation:
   - Extract duplicated logic into shared functions.
   - Improve naming and structure.
   - Run the test runner after each refactor to ensure tests stay green.
6. **Verify the cycle** with `maina verify` (or call the `verify` MCP tool) to confirm all deterministic checks pass on your changes.

## Example

```bash
# Generate stubs from the feature plan
maina spec

# Output:
# Created test stubs:
#   src/auth/__tests__/login.test.ts (5 tests)
#   src/auth/__tests__/session.test.ts (4 tests)
#   src/auth/__tests__/token.test.ts (3 tests)

# Red: confirm all stubs fail (use your project's test runner)
# 12 tests, 0 passed, 12 failed

# Green: implement one test at a time
# Edit src/auth/login.ts to make the first test pass
# Run only the relevant test to confirm it passes

# Continue until all tests pass
# 12 tests, 12 passed, 0 failed

# Refactor: clean up, keep tests green
# 12 tests, 12 passed, 0 failed

# Verify everything
maina verify
```

## Notes

- Use the test runner configured for your project. Maina auto-detects it from your project configuration.
- The `maina analyze` command checks that test tasks (T001: Write tests for X) appear before their implementation tasks (T002: Implement X) in the plan.
- Run a subset of tests during development by filtering on the test name or file path.
- Error handling tests should verify the `Result<T, E>` pattern: check `result.ok` is false and `result.error` contains the expected message.
- All commands are available as both CLI (`maina <command>`) and MCP tools when running inside an AI coding tool.
