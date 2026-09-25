---
"@mainahq/core": minor
"@mainahq/cli": minor
---

verify: type and test checks now cover the change's blast radius, read from the code graph (#330).

- When there is a graph store (`.maina/graph`), the pipeline asks it what the changed files can break: their callers (up to 3 hops), the files those live in, and the tests covering them. The result is on `PipelineResult.blastRadius`.
- The type checker also runs on those dependent files, so a caller in another workspace project gets checked too. The diff-only filter keeps a type error inside a caller, or on a dependent's import of a changed file, even though that line did not change. Changing a function's signature now fails verify in its callers instead of hiding the errors as pre-existing. Other tools still report on changed lines only.
- `maina verify --tests` (`runPipeline({ tests: true })`) runs only the affected tests: the graph's covering tests for the change and its callers, plus any changed test file. A failing test is an error finding. Only Bun's runner is supported for now; without it the `tests` report is skipped with a notice.
- Without a graph store, verify works as it did before.
