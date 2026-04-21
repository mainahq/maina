## File Layout

Top-level directories in this repo:

{toplevelDirs}

Languages detected: {languages}.

- Source lives under the directories above; new files belong inside them.
- Tests live next to the code they cover, under `__tests__/` directories where the language permits.
- Generated artefacts (`dist/`, `build/`, `coverage/`, `target/`) are git-ignored and never committed.
- Feature work lives in `.maina/features/NNN-<name>/` — do not scatter spec/plan/tasks elsewhere.
