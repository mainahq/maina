You are generating TDD test stubs from an implementation plan.

## Constitution (non-negotiable)
{{constitution}}

## Team conventions
{{conventions}}

## Test Thinking Framework

For each feature/function, think through FIVE categories of tests:

### 1. Happy Path (Smoke Tests)
The basic flow works as expected. User does the normal thing, gets the normal result.
- Input valid data → get expected output
- Standard workflow → completes successfully

### 2. Edge Cases
Boundary conditions, empty inputs, maximums, minimums, off-by-one.
- Empty array/string/object → handles gracefully
- Single item vs many items
- Maximum values, zero values, negative values
- Unicode, special characters, very long strings

### 3. Error Handling
What happens when things go wrong? Every failure mode should be tested.
- Invalid input → returns Result error (never throws)
- Missing dependencies → graceful degradation
- Network/filesystem failures → clear error message
- Concurrent access → no data corruption

### 4. Security
Think like an attacker. What inputs could cause harm?
- Path traversal: `../../etc/passwd` in file paths
- Injection: SQL injection in search queries, command injection in shell args
- XSS: HTML/script tags in user-provided text
- Oversized input: gigabyte strings, deeply nested objects
- Prototype pollution: `__proto__`, `constructor` in object keys

### 5. Integration Boundaries
Where this module meets the outside world.
- Database operations: test with real SQLite, not mocks where possible
- File system: use temp directories, clean up in afterEach
- External processes: mock Bun.spawn, verify correct args passed
- Module boundaries: test the public API, not internal helpers

## Instructions

Given the implementation plan below, generate test stubs using `bun:test`.

Rules:
- Use `describe` / `test` / `expect` from `bun:test`
- Write one `test(...)` per behavior, not per function
- Each stub must have a clear description of what it asserts
- Use `expect(...).toThrow()` for error cases (or check Result.ok === false)
- Group tests by the five categories above inside nested `describe` blocks
- Mock external dependencies (filesystem, network, DB) with `mock()` or `spyOn()`
- Stubs should fail until the implementation is written — do not pre-fill assertions
- ALWAYS include at least one security test per module that handles user input

Do NOT:
- Generate implementation code
- Use Jest-specific APIs (`jest.fn()`, `jest.mock()`)
- Write tests that test implementation details instead of behavior
- Skip edge cases because "they seem unlikely"

If the plan is underspecified, use [NEEDS CLARIFICATION: which behaviors should be tested?] before generating.

Output format: a single TypeScript file with all test stubs, ready to run with `bun test`.

## Implementation plan
{{plan}}
