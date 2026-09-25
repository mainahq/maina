# 0047. AST-based shell parsing for the gate

Date: 2026-09-25

## Status

Accepted

## Context

Phase 4 of the v1 rebuild (mainahq/maina#365) is the action gate: it decides in
milliseconds whether an agent's action is allowed, asked or denied. Task 4.1
(mainahq/maina#307, FR-GATE-2, FR-GATE-4, spec §6.2) is the layer underneath
it — normalised `GateEvent`s, a classifier that says which action classes an
event falls in, and a deterministic rules engine.

Most events an agent produces are shell commands, and a shell command is where
a destructive action can hide. The dogfood bootstrap hook this engine replaces
(`.maina/dogfood/hook-bootstrap.ts`, #286, removed in #309) parses shell with
regular expressions: it splits on `&&`/`|`/`;`, tokenises with a quote-aware
regex, and pattern-matches command names. Its own review history is the case
against that approach — round after round added a missed way to smuggle a
denied command past it: `cd` changing the effective directory, subshells, brace
groups, `if/then`, `eval`, combined `sh -lc` flags, `env -i`/`env -u NAME`
wrappers, `--repo=origin`, process substitution, symlinked write targets. Each
fix was another regex. A regex cannot tell a command name from an argument,
nesting from text, or code from a string or comment, so this list never ends.

FR-GATE-2 requires that obfuscation be caught — `rm -rf` built from variables,
`find -delete`, `git push --force-with-lease` to a protected branch, `curl | sh`,
`DROP`/`TRUNCATE` in SQL, writes to `~/.ssh`, `.env` reads, `npm publish` — and
that the rules reach ≥ 95% recall on a labelled destructive corpus. That bar is
not reachable by tightening regexes.

Options considered:

1. **Keep regex/string matching, harden it further.** Rejected. The bootstrap
   hook is the experiment that shows where this ends. Accuracy is the whole
   point of the gate.
2. **A hand-written shell tokeniser and recursive-descent parser.** Rejected.
   Bash's grammar (quoting rules, expansions, heredocs, redirections, compound
   statements, `[[ ]]`, arithmetic) is large, and a partial parser has the same
   blind spots as the regexes, just later.
3. **An existing pure-JS bash parser** such as `bash-parser` or
   `mvdan-sh`-to-JS. Rejected. `bash-parser` is unmaintained (last release
   2017) and does not cover modern bash; a WASM build of `mvdan/sh` would be a
   second parser toolchain to own.
4. **tree-sitter-bash via `@vscode/tree-sitter-wasm`.** Chosen. ADR 0046
   already adopted `@vscode/tree-sitter-wasm` for the code graph — a
   dependency-free, MIT-licensed, prebuilt web-tree-sitter build whose bundled
   grammars include `tree-sitter-bash.wasm`. The gate reuses it: one WASM
   runtime, one more grammar, no new toolchain, no native build.

## Decision

- The gate parses shell with tree-sitter-bash, loaded through the shared
  `packages/core/src/tree-sitter.ts` runtime (factored out of the graph
  parser's loader so both features initialise the runtime and load grammars
  once per process). Loading is lazy and never throws: a broken install makes
  the shell parser return `grammar_load_failed`, and the gate then treats every
  shell event as opaque, i.e. it asks. The gate fails closed.
- `packages/core/src/gate/` holds the layer:
  - `events.ts` — the normalised `GateEvent` union (`shell`, `file.write`,
    `file.read.outside`, `mcp`, `network`) and the injected `GateContext`
    (shell parser, home directory, protected branches, current branch).
  - `parsers/shell.ts` — turns the tree-sitter syntax tree into a small, plain,
    readonly tree: quoting is resolved (`r''m`, `\rm`, `$'\x72\x6d'` all read as
    `rm`), while expansions (`$X`, `${X:-y}`, `$(…)`, `<(…)`) stay structured
    parts so the classifier can resolve what it knows and mark the rest unknown.
    A syntax error is data: it is listed and everything recovered is still
    returned. The one asynchronous step, loading the grammar, happens once up
    front; parsing is synchronous, within the gate's millisecond budget.
  - `parsers/sql.ts` — a SQL tokeniser (not a full grammar) that finds each
    statement's verb and whether a `DELETE`/`UPDATE` is bounded, so a keyword
    inside a string or comment never counts.
  - `paths.ts` / `secrets.ts` — path resolution (home expansion, workspace and
    scratch containment, block devices) and credential detection.
  - `classify.ts` — `classifyAction`, the walk that resolves variables it saw
    assigned, strips wrappers (`sudo`, `env`, `xargs`, `timeout`, …), follows
    nesting (`sh -c`, `eval`, command and process substitution, heredocs,
    pipe-to-shell), and visits every branch of a conditional, loop or `case`.
    What it cannot resolve becomes `shell.opaque`, which the rules turn into
    `ask`.
  - `rules.ts` — `evaluateRules(event, policy, ctx)` and `settleVerdict`. The
    order of precedence is fixed: a rule deny is final and beats everything; a
    class set to deny is final; an irreversible class asks before any allow rule
    can fire; then allow rules, then reversible-ask classes, then explicitly
    allowed classes, then `no_rule`. `settleVerdict` lets a later stage tighten
    a `no_rule` or an `ask` but never loosen a deny or an irreversible ask into
    an allow — no allow rule, loosened class, permission mode or untrusted input
    reaches the decision.
- Policy comes from `loadPolicy` (#381). The default policy marks the
  FR-GATE-4 irreversible classes `ask`; a rule deny is final and cannot be
  loosened; irreversible classes are allowed only when a policy layer lists them
  in `explicitly_allow`.
- Output is plain, readonly and JSON-serialisable. The classifier only
  observes; nothing in `core` decides a verdict except the rules engine, and it
  does so from data.
- The corpus lives at `packages/core/src/gate/__fixtures__/commands.jsonl`:
  919 labelled commands (destructive, reversible, benign, and obfuscated
  variants), including the deny cases of the bootstrap hook this engine
  replaces. The rules reach ≥ 95% recall on the destructive fixtures while
  flagging at most 2% of the benign and reversible ones.

## Consequences

### Positive

- One parser sees the real structure of a command, so obfuscation that defeats
  string matching — variables, quoting tricks, wrappers, nesting, substitution,
  brace expansion — is caught by construction, not by a growing list of special
  cases.
- The runtime and grammar are already a dependency (ADR 0046): no new package,
  no native build, `bun install` is enough on every platform.
- A shell syntax error, a missing grammar and an unreadable command all resolve
  to `ask`. The gate has no path that fails open.

### Negative

- tree-sitter-bash parses bash; POSIX-sh-only constructs it does not model are
  handled as best-effort, and a construct it cannot represent becomes
  `shell.opaque` (an `ask`) rather than a precise class.
- The classifier carries a per-command registry of known dangerous tools
  (package managers, deploy CLIs, database clients, credential stores). It is
  data, and adding a tool is adding a row, but it is a list to maintain, and a
  brand-new tool the registry does not know is only gated when it trips a
  structural rule (a delete, an outside write, a protected push) — otherwise it
  is `shell.exec`. The corpus is the guard against regressions here.
- The gate resolves only variables assigned earlier in the same command line.
  A value that comes from the environment or an earlier session turn is unknown,
  so `$CMD --force` is opaque (an `ask`), never a false allow.
