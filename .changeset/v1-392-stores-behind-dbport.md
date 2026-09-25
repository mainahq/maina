---
"@mainahq/core": major
"@mainahq/cli": patch
---

`@mainahq/core`'s published types no longer name `bun:sqlite` or `drizzle-orm`, so a Node TypeScript project with `skipLibCheck: false` can typecheck against them. The `.maina` SQLite stores are now handed out behind `DbPort`: `openDecisionStore(mainaDir)` and `openFeedbackStore(mainaDir)` return `Result<DbStore>`, which is `{ db: DbPort; close }`. `getDecisionDb`, `getFeedbackDb`, `toDbPort` and the `DbHandle`, `SqliteDatabase`, `SqliteStatement`, `SqlBinding`, `SqlBindings` and `SqlChanges` types are no longer exported. `maina doctor` reads feedback stats through the port and now closes the feedback database when it is done. CI builds the published packages and typechecks their `dist/index.d.ts` under Node types (`bun run check:dts`).
