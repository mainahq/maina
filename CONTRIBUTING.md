# Contributing to Maina

Thank you for your interest in contributing to Maina. This guide covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh) (latest stable)
- Git 2.30+

## Dev Setup

```bash
git clone https://github.com/mainahq/maina.git
cd maina
bun install
bun run build
bun run test
```

## Project Structure

Maina is a monorepo with the following packages:

| Package | Purpose |
|---------|---------|
| `packages/cli` | Commander entrypoint, commands, terminal UI |
| `packages/core` | Three engines (Context, Prompt, Verify), cache, AI, git, DB |
| `packages/mcp` | MCP server (delegates to engines) |
| `packages/skills` | Cross-platform skills (Claude Code, Cursor, Codex, Gemini CLI) |
| `packages/docs` | Documentation site |

## Development Workflow

We dogfood Maina throughout development. Use the CLI tools whenever possible:

```bash
maina verify     # Full verification: lint + typecheck + test
maina commit     # AI-assisted conventional commit
maina review     # Code review before PR
```

## Testing

All tests use `bun:test` (not Jest or Vitest).

```bash
bun run test                 # Run all tests
bun test --filter <pattern>  # Run specific tests
```

Write tests first (TDD). Watch them fail, implement, watch them pass.

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) with the following scopes:

- `cli` -- CLI package changes
- `core` -- Core engine changes
- `mcp` -- MCP server changes
- `skills` -- Skills package changes
- `docs` -- Documentation changes
- `ci` -- CI/CD changes

Examples:

```
feat(core): add PageRank scoring to context engine
fix(cli): handle missing config file gracefully
test(core): add verify engine edge cases
```

## Code Style

- **Formatter/Linter:** Biome 2.x (not ESLint or Prettier). Run `bun run check`.
- **Language:** TypeScript in strict mode.
- **Error handling:** Use the `Result<T, E>` pattern. Never throw exceptions.
- **No `console.log`** in production code.
- **Diff-only:** Report findings only on changed lines.

## PR Process

1. Fork the repo and create a feature branch from `master`.
2. Implement your changes with tests.
3. Run `maina verify` (or `bun run verify`) to confirm everything passes.
4. Push your branch and open a pull request.
5. Fill out the PR template.
6. Address review feedback.

## Dogfood gate (v1 PRs)

PRs into `v1/*` carry a **maina receipt** for their head commit. After your
last push, run one command from the PR branch:

```bash
bun run dogfood:receipt
```

It refuses a dirty tree, checks HEAD is the pushed PR head, runs the maina 1.x
verify pipeline over the files the PR changes (versus its merge-base), writes
`.maina/dogfood/receipts/<sha>.json`, posts the receipt as a PR comment and
re-runs the **Dogfood** check. Every new push needs a new receipt. The check
passes only if the receipt's commit equals the PR head and its status is
`passed`. It is **report-only** until the `DOGFOOD_RECEIPT_REQUIRED`
repository variable is set to `true` and "Dogfood / receipt" is made a
required status.

With lefthook installed (`bunx lefthook install`), `pre-push` writes the local
receipt for you (`--no-publish --no-fail`, never blocks a push); the command
above then just publishes it.

Claude Code sessions in this repo also load `.claude/settings.json`, which
runs maina's own gate as a `PreToolUse` hook (`scripts/dogfood/hook.ts`): the
Claude Code adapter and the fail-closed hook client from source, the same path
as `maina hook --host claude PreToolUse`. The first call spawns the resident runtime; if it
cannot answer in time, the rules-only gate runs in process and never allows.
The hook only tightens: `ask` and `deny` are passed on, an `allow` stays silent
so Claude Code's own permission flow applies, and it fails closed to `ask` if
it cannot run. To override a deny, start Claude Code with
`MAINA_DOGFOOD_OVERRIDE=1` (denies become `ask`). The runtime appends its
gate decisions to the decision log, `.maina/decisions.db` (hashes and labels
only); the hook also keeps a local trail with the command text in
`.maina/dogfood/log.jsonl`. Both are gitignored. The hook only runs when
Claude Code is started in a v1 checkout (project settings load from the
directory Claude Code starts in, not from a worktree under it).

The `PostToolUse` and `PostToolUseFailure` hooks (`hook.ts post`) append a
`ran` record for each gated call that ran, whether the tool succeeded or
failed, with the call's `toolUseId` and `sessionId` (never its output or
error). The `PermissionDenied` hook appends a `denied` record when the
auto-mode classifier denies a call. So an ask's outcome can be read from the
log: approved if it ran, denied by the classifier, or refused or abandoned
if neither. `bun run dogfood:report` prints the week's counts. Set `MAINA_DOGFOOD_LOG` globally, for example to
`~/.maina/dogfood/log.jsonl` in your shell profile, so every checkout and
worktree appends to one file.

The weekly dogfood report comes from the decision log. Commit the week that
just ended from the checkout where the gate ran:

```bash
maina digest --dogfood --commit     # or: bun run dogfood:report, then commit
```

It writes `docs/dogfood/<yyyy-ww>.md` and commits that file alone; it
refuses to commit a week with no gate decisions, which would not count. The
Monday workflow keeps a committed report and opens a bot PR with the
recomputed `docs/dogfood/dogfood-weeks.json`, publishing the bot head's own
receipt. Report friction with the **Dogfood friction** issue template.

## Getting Help

- Open an issue for bugs or feature requests.
- Use the issue templates provided.
