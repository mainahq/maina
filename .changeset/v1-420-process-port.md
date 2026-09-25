---
"@mainahq/core": major
---

`CorePorts` gains a required `process: ProcessPort` member (`spawn(argv, { cwd, env?, timeoutMs? })` returning `Result<{ exitCode, stdout, stderr }, ProcessError>`; non-zero exits are data, spawn failures and timeouts are typed errors). The git adapter and the built-in type checker now spawn through it (`runTypecheck` takes an optional `process` port), and the system adapter drops git's repository-local variables (`GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`, ...) from the inherited environment, so a leaked `GIT_DIR` from a git hook no longer redirects core git reads away from the explicit root. The purity ratchet now flags direct `Bun.spawn`/`Bun.spawnSync` in core.
