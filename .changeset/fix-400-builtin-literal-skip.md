---
"@mainahq/core": patch
---

The built-in `no-any-type` and `todo-comment` verify checks no longer flag text that only mentions their patterns. A regex literal such as `/(?:as any|: any\b)/`, or a string such as `"AI generated TODO without ticket reference"`, used to raise a warning or info finding on every change to the slop and review heuristics. Both checks now use the line lexer shared with the slop detector: `no-any-type` ignores comments (including multi-line block comments) and string, template and regex literals, and in JS/TS files `todo-comment` only reads comment text. Other languages keep the whole-line TODO scan.
