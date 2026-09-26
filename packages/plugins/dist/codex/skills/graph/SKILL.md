---
name: graph
description: Use maina's code graph to see what a change can affect (callers, dependent files, covering tests and a blast score) and to pull only the source you need within a token budget. Use before changing a file, function or type that other code depends on, when planning a refactor, when choosing which tests to run, or instead of reading whole files to understand unfamiliar code.
license: Apache-2.0
compatibility: Requires maina (the plugin or the CLI) in a git repository.
metadata:
  author: mainahq
---

> This plugin bundles the maina CLI: run it as `../../launcher/launch.sh cli <command>`, a path relative to this skill's folder.

# Graph

## When to use

- Before you change a file, function, type or export that other code may depend on.
- When planning a refactor or a rename and you need to know how far it reaches.
- When picking which tests to run for a change.
- When you need to understand unfamiliar code and would otherwise read many whole files.

## Steps

1. **Check the graph is ready.** Call the `status` MCP tool; it reports whether the code graph (and the wiki and policy) are ready. maina keeps the graph current by itself: it syncs changed files when a session starts and updates the files you edit, and their dependents, as you go.
2. **Measure the impact first.** Call the `impact` MCP tool with the `files` or `symbols` you plan to change (raise `depth` to follow callers further). It returns transitive callers, dependent files, the tests that cover them, and a blast score: the share of the repo's files the change touches. Paths it lists as not in the code graph are unknown to it, not safe.
3. **Let the reach set your care.** A narrow reach: change it and run the covering tests. A wide one: tell the user what it reaches before changing it, prefer an additive change (a new function or parameter with a default) over a breaking one, and plan the change in steps.
4. **Read only what you need.** Call the `context` MCP tool with the `files` or a free-text `query` and a `budgetTokens` limit. It returns the relevant source and its call-graph neighbourhood, and how many tokens that saved over reading whole files.
5. **Run the affected tests.** After the change, run `../../launcher/launch.sh cli verify --tests`: verify plus the tests the graph links to your change (see the verify skill).

## Example

Call `impact` with `symbols: ["parseConfig"]`:

```text
impact: 1 target(s), 14 caller(s), 9 dependent file(s), 6 test(s); blast score 0.12
dependents:
- src/cli/init.ts
- src/cli/doctor.ts
- ...
```

Nine dependent files is a wide reach: add an optional parameter with a default rather than changing the signature, then run `../../launcher/launch.sh cli verify --tests`.

## Notes

- The graph is built from the syntax tree of the source, so it sees real calls and imports, not text matches.
- For questions about why the code is shaped as it is, the maina wiki answers with cited articles: `../../launcher/launch.sh cli wiki query "<question>"`, or the `ask_question` MCP tool when the server enables it.
- Impact is a guide, not a proof: dynamic calls and reflection can reach code the graph does not see, so the tests still decide.
