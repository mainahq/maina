---
"@mainahq/core": major
"@mainahq/cli": patch
---

The published `@mainahq/core` declarations no longer reference drizzle-orm, so a Node TypeScript project with `skipLibCheck: false` can typecheck against them. Before this, `dist/index.d.ts` imported `drizzle-orm/sqlite-core` through `DbHandle`, and drizzle's own declarations failed with TS2307 because they need optional packages such as `gel` and `mysql2`. Core now hands out SQLite stores only as a `DbPort` plus `close`: `openFeedbackStore(mainaDir)` and `openDecisionStore(mainaDir)` return `Result<DbStore>`. `getFeedbackDb`, `getDecisionDb` and the `DbHandle` type are no longer exported. `maina doctor` now closes the feedback database after reading its stats. A test builds the declarations as the release does and typechecks a consumer of them with Node types only.
