# Maina — Implementation Plan

**Methodology: Superpowers-style subagent-driven development with TDD.**
**From zero to `bunx maina` in 10 sprints.**

---

## How to use this plan

This plan follows the Superpowers workflow: each sprint is a feature with tasks. Hand each sprint to Claude Code using the delegation prompt at the end. Claude Code dispatches a fresh subagent per task, runs two-stage review (spec compliance, then code quality), and commits after each task passes.

**Rules:**

1. **TDD always.** Write the test first. Watch it fail. Write minimal code. Watch it pass. Commit.
2. **One task, one commit.** Each task produces exactly one conventional commit.
3. **Subagent per task.** Fresh context for each task. The delegation prompt provides all needed context.
4. **Two-stage review.** After each task: (a) does it match the spec? (b) is the code clean?
5. **Dogfood from Sprint 3.** Every commit to Maina goes through `maina commit`.
6. **Model tiers.** Mechanical tasks (scaffolding, test stubs) use cheap models. Architecture tasks use powerful models.

---

## Sprint 0 — Skeleton

**Goal:** `maina --version` works. Monorepo scaffolded. All tooling configured.

### Tasks

**T001 — Init Bun monorepo**
```
- [ ] Create root package.json with workspaces: packages/cli, packages/core, packages/mcp, packages/skills
- [ ] bun init in each workspace
- [ ] Root tsconfig.json with strict mode, package-specific extends
- [ ] Verify: `bun install` succeeds, `bun run typecheck` succeeds
```

**T002 — Configure Biome 2.x**
```
- [ ] bun add -D @biomejs/biome
- [ ] Create biome.json: lint + format + import sorting
- [ ] Rules: noExplicitAny (error), useConst (error), noConsoleLog (warn)
- [ ] Verify: `bun run check` runs biome check on all packages
```

**T003 — Configure lefthook + commitlint**
```
- [ ] bun add -D lefthook @commitlint/cli @commitlint/config-conventional
- [ ] lefthook.yml: pre-commit runs biome check + tsc --noEmit in parallel
- [ ] commitlint.config.ts: scopes = cli, core, mcp, skills, docs, ci
- [ ] Verify: bad commit message is rejected, unformatted code is rejected
```

**T004 — CLI entrypoint**
```
- [ ] bun add commander @clack/prompts in packages/cli
- [ ] Create packages/cli/src/index.ts with Commander program
- [ ] Register --version from package.json
- [ ] Test: `bun test` — maina --version outputs semver string
- [ ] Verify: `bunx .` runs and shows version
```

**T005 — Build configuration**
```
- [ ] bun add -D bunup in root
- [ ] bunup.config.ts for packages/cli (entry: src/index.ts, format: esm)
- [ ] Root scripts: dev, build, test, check, typecheck, verify
- [ ] Verify: `bun run build` produces dist/index.js
```

**T006 — CI + repo files**
```
- [ ] .github/workflows/ci.yml: install → check → typecheck → test
- [ ] .gitignore, LICENSE (Apache 2.0)
- [ ] Create PRODUCT_SPEC.md (copy from product spec)
- [ ] Create CLAUDE.md (from product spec template)
- [ ] Create AGENTS.md (from product spec template)
- [ ] Verify: CI workflow validates
```

### Delegation prompt
```
Read PRODUCT_SPEC.md and this IMPLEMENTATION_PLAN.md. Execute Sprint 0.
Scaffold the Bun monorepo exactly as described. TDD — write a test for
`maina --version` first, then implement. Configure biome.json, lefthook.yml,
commitlint.config.ts, bunup.config.ts. Use TodoWrite to track all 6 tasks.
Run `bun run verify` at the end and confirm everything passes.
```

---

## Sprint 1 — Context Engine

**Goal:** The four-layer context system works. `maina context` generates focused, layered output.

### Prompt examples from research

These are real patterns from production tools that inform how the Context Engine should work.

**Aider's repo map (PageRank for code relevance):**
```python
# From aider/repomap.py — the key insight
# Build a graph where files are nodes, cross-file references are edges
# Run PageRank with personalization biased toward current conversation

personalization = {}
for fname in chat_fnames:    # Files the user is working with
    personalization[fname] = 50.0  # Heavy bias
for fname in mentioned_fnames:  # Identifiers mentioned in task
    personalization[fname] = 10.0

# Private names get downweighted
if ident.startswith("_"):
    weight *= 0.1

# Identifiers defined in many files are too generic
if len(defining_files) > 5:
    weight *= 0.1

ranked = nx.pagerank(G, personalization=personalization)
```

**Maina's equivalent in TypeScript:**
```typescript
// packages/core/src/context/relevance.ts
export function scoreRelevance(
  graph: DependencyGraph,
  currentTask: TaskContext,
): Map<string, number> {
  const personalization = new Map<string, number>();

  // Files touched in current session: heavy bias
  for (const f of currentTask.touchedFiles) {
    personalization.set(f, 50.0);
  }

  // Identifiers mentioned in ticket: moderate bias
  for (const f of currentTask.mentionedFiles) {
    personalization.set(f, 10.0);
  }

  return pageRank(graph, { personalization, dampingFactor: 0.85 });
}
```

**Instar's layered memory failure lesson:**
```
// WRONG: Single file loaded at session start
// Instar tried this. Worked for a week, then grew so large it
// overwhelmed the agent's working memory.
const memory = fs.readFileSync('.instar/MEMORY.md', 'utf-8');

// RIGHT: Layered retrieval with selective loading
// Each command declares what it needs. The selector assembles
// only relevant context within budget.
const context = await contextEngine.assemble('commit', {
  working: true,           // Always
  episodic: false,         // Not needed for commits
  semantic: ['conventions'], // Only conventions, not full graph
  retrieval: false,        // Not needed
});
```

### TDD contract

```typescript
describe('ContextEngine', () => {
  describe('Layer 1: Working', () => {
    it('should track current branch and plan');
    it('should track files touched in session');
    it('should store last verification result');
    it('should reset on branch switch');
  });

  describe('Layer 2: Episodic', () => {
    it('should compress entries to <500 tokens each');
    it('should apply Ebbinghaus decay: relevance = exp(-0.1 * daysSinceAccess)');
    it('should reinforce relevance on access');
    it('should auto-prune below 0.1 relevance');
  });

  describe('Layer 3: Semantic', () => {
    it('should extract entities from tree-sitter AST');
    it('should build dependency graph from imports');
    it('should score relevance via PageRank with personalization');
    it('should load constitution.md as top-priority context');
    it('should load custom context from .maina/context/semantic/custom/');
  });

  describe('Layer 4: Retrieval', () => {
    it('should search code via Zoekt when available');
    it('should fall back to ripgrep when Zoekt not installed');
  });

  describe('Budget Manager', () => {
    it('should enforce 60% budget in focused mode');
    it('should expand to 80% in exploration mode');
    it('should contract to 40% in commit mode');
    it('should truncate lowest-priority layer when over budget');
    it('should never truncate working context');
  });

  describe('Selector', () => {
    it('should return only working context for commit command');
    it('should return all layers for context command');
    it('should return working + semantic(conventions) for verify command');
  });
});
```

### Tasks

**T001 — Database schema (all 3 SQLite databases)**
```
- [ ] packages/core/src/db/schema.ts — Drizzle tables:
      episodic_entries, semantic_entities, dependency_edges,
      cache_entries, feedback, prompts
- [ ] packages/core/src/db/index.ts — init .maina/context/index.db,
      .maina/cache/cache.db, .maina/feedback.db
- [ ] Test: databases create on first access, tables exist
```

**T002 — tree-sitter WASM setup**
```
- [ ] bun add web-tree-sitter
- [ ] packages/core/src/context/treesitter.ts:
      initParser(language), parseFile(path), extractImports(ast),
      extractExports(ast), extractFunctions(ast)
- [ ] Support: TypeScript, JavaScript, Python, Go, Rust
- [ ] Test: parse a TS file, extract 3 imports, 2 exports, 4 functions
```

**T003 — Layer 1: Working context**
```
- [ ] packages/core/src/context/working.ts
- [ ] Tracks: branch, PLAN.md contents, touched files, last verification
- [ ] Persists to .maina/context/working.json
- [ ] Resets on branch switch (detected via git)
- [ ] Test: touch file → appears in working context; switch branch → reset
```

**T004 — Layer 3: Semantic context with PageRank**
```
- [ ] packages/core/src/context/semantic.ts
- [ ] packages/core/src/context/relevance.ts — PageRank implementation
- [ ] Scans repo with tree-sitter, builds entity index
- [ ] Dependency graph as adjacency list with weighted edges
- [ ] PageRank with personalization vector (see prompt example above)
- [ ] Loads constitution.md, .cursorrules, CONVENTIONS.md, AGENTS.md
- [ ] Loads custom files from .maina/context/semantic/custom/
- [ ] Incremental update: only re-parse changed files (git diff based)
- [ ] Test: build graph for Maina repo, verify PageRank ranks
        core/context/engine.ts higher than docs/README.md
```

**T005 — Layer 2: Episodic context with Ebbinghaus decay**
```
- [ ] packages/core/src/context/episodic.ts
- [ ] Each entry: content, summary, relevance, accessCount, timestamps
- [ ] Decay: relevance = exp(-0.1 * daysSinceAccess) + 0.1 * accessCount
- [ ] Reinforce on access: update lastAccessedAt, increment accessCount
- [ ] Auto-prune below 0.1 relevance, max 100 entries
- [ ] Test: create entry → wait (mock time) → relevance decays;
        access entry → relevance resets
```

**T006 — Layer 4: Retrieval context**
```
- [ ] packages/core/src/context/retrieval.ts
- [ ] Zoekt integration when installed (detect via `which zoekt`)
- [ ] Fallback: ripgrep or grep -r with .gitignore respect
- [ ] Results limited to token budget allocation
- [ ] Test: search for "ContextEngine" → finds engine.ts
```

**T007 — Budget manager**
```
- [ ] packages/core/src/context/budget.ts
- [ ] calculateTokens(text) — approximate: chars / 3.5
- [ ] assembleBudget(mode, modelContextWindow) — dynamic allocation
- [ ] Priority truncation: retrieval → episodic → semantic → never working
- [ ] Test: assemble with mode='focused' → budget is 40%;
        assemble with mode='explore' → budget is 80%
```

**T008 — Context selector**
```
- [ ] packages/core/src/context/selector.ts
- [ ] Maps commands to context needs:
      commit:  { working: true, episodic: false, semantic: ['conventions'] }
      verify:  { working: true, episodic: ['recent-reviews'], semantic: ['adrs', 'conventions'] }
      context: { working: true, episodic: true, semantic: true, retrieval: true }
      review:  { working: true, episodic: ['past-reviews'], semantic: ['adrs'] }
      plan:    { working: true, semantic: ['adrs', 'conventions'] }
- [ ] Test: selector('commit') returns only working + conventions;
        selector('context') returns all 4 layers
```

**T009 — Context engine orchestrator**
```
- [ ] packages/core/src/context/engine.ts
- [ ] assembleContext(command, scope?) — main entry point
- [ ] Coordinates: selector → layers → budget → assembled output
- [ ] Returns: { text: string, tokens: number, layers: LayerReport[] }
- [ ] Test: assembleContext('commit') returns < 40% budget;
        assembleContext('context') returns comprehensive output
```

**T010 — Git operations**
```
- [ ] packages/core/src/git/index.ts
- [ ] getRecentCommits(n), getChangedFiles(since), getCurrentBranch()
- [ ] getRepoRoot(), getDiff(ref1, ref2), getStagedFiles()
- [ ] Uses Bun.spawn — no deps
- [ ] Test: getCurrentBranch() returns string matching git output
```

**T011 — CLI: `maina context`**
```
- [ ] packages/cli/src/commands/context.ts
- [ ] Options: --scope <dir>, --show (layers report), --no-ai, --mode explore|focused
- [ ] Calls contextEngine.assembleContext('context', scope)
- [ ] Writes CONTEXT.md to repo root
- [ ] Shows @clack/prompts spinner + layer report
- [ ] Test: maina context produces CONTEXT.md with all 4 layers
```

**T012 — CLI: `maina context add <file>` + `maina context show`**
```
- [ ] context add: copies file to .maina/context/semantic/custom/
- [ ] context show: displays each layer with entry count + token count
- [ ] Test: add a file → it appears in semantic layer;
        show displays accurate token counts
```

### Plan verification checklist
```
Before committing PLAN.md, verify:
- [ ] Every TDD test in the contract maps to a task
- [ ] No task touches more than 3 files
- [ ] Type/function names are consistent across tasks
- [ ] No TODO/placeholder markers remain
- [ ] Tasks are ordered: dependencies before dependents
```

### Delegation prompt
```
Read PRODUCT_SPEC.md and IMPLEMENTATION_PLAN.md Sprint 1.

Build the Context Engine — Maina's brain. This is the most important sprint.

Start with ALL tests from the TDD contract. Watch them fail.

The Context Engine has 4 layers:
- Working: current branch, touched files, last verification
- Episodic: compressed history with Ebbinghaus decay
- Semantic: tree-sitter entities, PageRank-scored dependency graph
- Retrieval: Zoekt/ripgrep on-demand search

Key architectural decisions:
- PageRank with personalization vector biased toward current task
  (see relevance.ts pattern in the plan)
- Dynamic budget: 60% default, 80% explore, 40% focused
- Each command declares its context needs via selector
- Constitution.md is always loaded as top-priority semantic context

Use web-tree-sitter for AST, bun:sqlite + Drizzle for storage.
Use TodoWrite to track all 12 tasks.
Dispatch a fresh subagent per task.
Two-stage review after each: (1) spec compliance (2) code quality.
Test by running `maina context` on this repo.
```

---

## Sprint 2 — Cache System + Prompt Engine

**Goal:** AI calls are cached. Prompts are user-customisable, versioned, and evolving.

### Prompt examples from research

**PR-Agent's prompt engineering pattern (TOML + Jinja2):**
```toml
# From pr_agent/settings/pr_reviewer_prompts.toml
# PR-Agent embeds output schemas directly in prompts

[pr_reviewer_prompt]
system = """You are a language-agnostic code reviewer.
Your task is to review a Pull Request.

The review should focus on new code (lines starting with '+').
Provide feedback on code quality, security, and best practices.

You must use the following YAML schema for your response:

Review:
  estimated_effort_to_review:
    type: int
    description: "1-5 scale"
  security_concerns:
    type: string
    description: "yes/no, with brief explanation"
  key_issues:
    type: array
    items:
      relevant_file:
        type: string
      issue_header:
        type: string
      issue_content:
        type: string
      start_line:
        type: int
      end_line:
        type: int
      severity:
        type: string
        enum: [critical, major, minor, trivial]
"""

user = """
## PR Info
Title: '{{title}}'
Branch: '{{branch}}'
Description: '{{description}}'

## Diff
```
{{diff}}
```
"""
```

**Maina's equivalent — default review prompt:**
```markdown
<!-- packages/core/src/prompts/defaults/review.md -->
# Review Prompt

You are reviewing code changes in a {{language}} codebase.

## Constitution (non-negotiable)
{{constitution}}

## Team conventions
{{conventions}}

## Instructions
Review ONLY the added/modified lines (lines starting with '+').
Focus on:
1. Security vulnerabilities (injection, XSS, auth bypass)
2. Business logic errors (wrong conditions, missing edge cases)
3. Missing error handling (unhandled promises, uncaught exceptions)
4. Violations of constitution or team conventions

Do NOT comment on:
- Style issues (handled by Biome)
- Naming conventions (handled by linter)
- Minor refactoring suggestions

For each issue found, respond in this exact format:

```yaml
issues:
  - file: "path/to/file.ts"
    line: 42
    severity: "critical|major|minor"
    issue: "Brief description"
    suggestion: "How to fix it"
    convention_violated: "Which constitution/convention rule, if any"
```

If no issues found, respond with:
```yaml
issues: []
summary: "No issues found. Code is clean and compliant."
```

## Diff to review
{{diff}}
```

**How the Prompt Engine assembles the final prompt:**
```typescript
// packages/core/src/prompts/engine.ts
export async function buildSystemPrompt(
  task: TaskType,
  context: AssembledContext,
): Promise<string> {
  // 1. Load default prompt template
  const defaultPrompt = loadDefault(task);

  // 2. Load user overrides from .maina/prompts/
  const userPrompt = loadUserOverride(task);

  // 3. Load constitution (always injected)
  const constitution = loadConstitution();

  // 4. Merge: user overrides > default, constitution always present
  const merged = mergePrompts(defaultPrompt, userPrompt);

  // 5. Inject context variables
  return renderTemplate(merged, {
    constitution,
    conventions: context.semantic.conventions,
    diff: context.working.diff,
    language: context.semantic.primaryLanguage,
    plan: context.working.plan,
  });
}
```

### TDD contract

```typescript
describe('CacheManager', () => {
  it('should return L1 hit for same query in same session');
  it('should return L2 hit for same query across sessions');
  it('should miss when file content hash changes');
  it('should miss when prompt version changes');
  it('should miss when model changes');
  it('should respect TTL: review=forever, context=1hr, explain=24hr');
  it('should evict oldest entries when max size exceeded');
});

describe('PromptEngine', () => {
  it('should load default prompt for each task type');
  it('should override with user prompt from .maina/prompts/');
  it('should always inject constitution as preamble');
  it('should inject [NEEDS CLARIFICATION] instruction');
  it('should version prompts by content hash');
  it('should track accept rate per prompt version');
  it('should propose improvements from feedback patterns');
  it('should A/B test candidate vs active (80/20 split)');
});
```

### Tasks

**T001 — Cache manager (L1 + L2)**
```
- [ ] packages/core/src/cache/manager.ts
      L1: in-memory LRU (Map, max 100 entries)
      L2: SQLite cache_entries table
      get(key) → checks L1 then L2, returns null on miss
      set(key, response, ttl) → stores in both
- [ ] Test: same key returns cached; different key misses
```

**T002 — Content-aware cache keys**
```
- [ ] packages/core/src/cache/keys.ts
      buildCacheKey(task, files, promptHash, model)
      hashFile(path) → SHA-256 of content
- [ ] Test: change file → key changes → cache misses
```

**T003 — TTL rules**
```
- [ ] packages/core/src/cache/ttl.ts
      Per-task TTL: review=Infinity, context=3600, explain=86400
- [ ] Test: expired entry returns null
```

**T004 — AI wrapper with cache + model tiers**
```
- [ ] bun add ai @ai-sdk/openai @ai-sdk/anthropic
- [ ] packages/core/src/ai/index.ts
      resolveModel(task) → reads maina.config.ts model tiers
      generate(task, prompt, context) → cache-first, AI on miss
- [ ] packages/core/src/ai/tiers.ts
      mechanical, standard, architectural, local tier resolution
- [ ] Test: same query twice → second call returns from cache
```

**T005 — Config loader**
```
- [ ] packages/core/src/config/index.ts
      Searches for maina.config.ts up directory tree
      Falls back to defaults (works without config)
      Merges env vars (MAINA_API_KEY)
- [ ] Test: no config file → defaults work; config exists → values override
```

**T006 — Default prompts**
```
- [ ] packages/core/src/prompts/defaults/
      review.md, context.md, tests.md, commit.md, fix.md,
      explain.md, design.md (see review.md example above)
- [ ] Each prompt includes {{constitution}} injection point
- [ ] Each prompt includes [NEEDS CLARIFICATION] instruction
- [ ] Test: loadDefault('review') returns valid template with variables
```

**T007 — Constitution + prompt loader**
```
- [ ] packages/core/src/prompts/loader.ts
      loadConstitution() → reads .maina/constitution.md
      loadUserOverride(task) → reads .maina/prompts/<task>.md
      mergePrompts(default, override) → user sections override, not replace
- [ ] Test: user prompt overrides specific section; constitution always present
```

**T008 — Prompt engine**
```
- [ ] packages/core/src/prompts/engine.ts
      buildSystemPrompt(task, context) → assembled prompt string
      recordOutcome(promptHash, outcome) → writes to feedback.db
      getPromptStats(task) → accept rate, usage count per version
- [ ] Test: buildSystemPrompt includes constitution + conventions + diff
```

**T009 — Prompt evolution**
```
- [ ] packages/core/src/prompts/evolution.ts
      analyseFeedback(task) → finds patterns in accepted/rejected
      proposeImprovement(task) → AI rewrites prompt from feedback
      createCandidate(task, newPrompt) → stores as 'candidate'
      abTest(task) → returns active or candidate (80/20 split)
      promote(hash) / retire(hash) → lifecycle management
- [ ] Test: after 30 rejections of style comments →
        proposeImprovement removes style focus
```

**T010 — CLI: `maina prompt edit` + `maina prompt list`**
```
- [ ] prompt edit <task> → opens .maina/prompts/<task>.md in $EDITOR
      Creates from default template if doesn't exist
- [ ] prompt list → shows all tasks with version, accept rate, usage count
- [ ] Test: prompt edit creates file; prompt list shows active versions
```

**T011 — CLI: `maina cache stats`**
```
- [ ] Shows: hit rate, tokens saved, cost saved, storage used
- [ ] Test: after cached queries → stats show accurate counts
```

**T012 — CLI: `maina learn`**
```
- [ ] Analyses feedback across all tasks
- [ ] For tasks with 30+ samples: proposes prompt improvements
- [ ] Shows diff: current vs proposed
- [ ] Accept/modify/reject via @clack/prompts
- [ ] If accepted: creates candidate for A/B testing
- [ ] Test: mock 30 rejections → learn proposes relevant improvement
```

### Delegation prompt
```
Read PRODUCT_SPEC.md and IMPLEMENTATION_PLAN.md Sprint 2.

Build the Cache System and Prompt Engine.

Start with ALL tests from the TDD contract. Watch them fail.

Cache has 3 layers: memory LRU → SQLite → AI call.
Cache keys include content hashes — change a file, cache invalidates.

Prompt Engine assembles: constitution (always) + default prompt +
user overrides (.maina/prompts/) + context variables.

Study the PR-Agent prompt pattern in the plan (TOML + Jinja2 style
with YAML output schema). Maina's prompts use the same pattern:
structured output schema embedded in the prompt, parsed with error
recovery.

Key rule: every AI output records the prompt hash + outcome in
feedback.db. This feeds the prompt evolution loop in `maina learn`.

Use TodoWrite to track all 12 tasks. Fresh subagent per task.
Two-stage review after each.
```

---

## Sprint 3 — Verify Engine + `maina commit`

**Goal:** Full verification pipeline. `maina commit` gates every commit.

### Prompt examples from research

**SWE-agent's syntax guard pattern:**
```python
# From SWE-agent — linter-on-edit guardrail
# The highest-impact design decision: reject syntactically invalid
# edits BEFORE they enter history. Prevents cascading errors.

def apply_edit(file, old_str, new_str):
    # Apply the edit
    new_content = content.replace(old_str, new_str)

    # Run linter IMMEDIATELY
    lint_result = run_linter(file, new_content)
    if lint_result.has_errors:
        # REJECT the edit — it never enters history
        return Error(f"Edit rejected: {lint_result.errors}")

    # Only save if linter passes
    write_file(file, new_content)
    return Ok()
```

**Maina's syntax guard equivalent:**
```typescript
// packages/core/src/verify/syntax-guard.ts
export async function syntaxGuard(stagedFiles: string[]): Promise<Result<void, SyntaxError[]>> {
  // Biome check is < 500ms for typical changesets
  const result = await Bun.spawn(['biome', 'check', '--no-errors-on-unmatched', ...stagedFiles]);

  if (result.exitCode !== 0) {
    // REJECT immediately. Don't waste time on tests, coverage, slop.
    const errors = parseBiomeOutput(result.stderr);
    return Err(errors);
  }

  return Ok(undefined);
}
```

**Reviewdog's diff-only filtering pattern:**
```go
// From reviewdog/reviewdog.go — only report on changed lines
// This eliminates noise from pre-existing issues

func (r *Reviewdog) Run(results []*Result) []*FilteredResult {
    diff := r.getDiff()  // git diff against base branch

    var filtered []*FilteredResult
    for _, result := range results {
        if diff.Contains(result.File, result.Line) {
            filtered = append(filtered, result)
        }
    }
    return filtered
}
```

**Maina's diff-only filter:**
```typescript
// packages/core/src/verify/diff-filter.ts
export async function filterByDiff(
  findings: Finding[],
  baseBranch: string = 'main',
): Promise<{ shown: Finding[]; hidden: number }> {
  const changedLines = await getChangedLines(baseBranch);
  const shown = findings.filter(f =>
    changedLines.has(`${f.file}:${f.line}`)
  );
  return { shown, hidden: findings.length - shown.length };
}
```

### TDD contract

```typescript
describe('SyntaxGuard', () => {
  it('should pass valid TypeScript files');
  it('should reject files with syntax errors');
  it('should complete in < 500ms for 10 files');
  it('should return structured error with file + line + message');
});

describe('VerifyPipeline', () => {
  it('should auto-detect installed tools');
  it('should run all detected tools in parallel');
  it('should skip missing tools with info note');
  it('should apply diff-only filtering by default');
  it('should report pre-existing count as hidden');
  it('should produce unified pass/fail');
});

describe('SlopDetector', () => {
  it('should detect empty function bodies via AST');
  it('should detect hallucinated imports');
  it('should detect console.log in production code');
  it('should detect TODO without ticket reference');
  it('should detect commented-out code blocks > 3 lines');
  it('should cache results for unchanged files');
});

describe('CommitGate', () => {
  it('should run syntax guard FIRST, before parallel gates');
  it('should block on syntax failure without running other gates');
  it('should run remaining gates in parallel after syntax passes');
  it('should support --skip flag');
  it('should record results in feedback.db');
  it('should execute .maina/hooks/pre-commit.sh if present');
});
```

### Tasks

**T001 — Hooks runner**
```
- [ ] packages/core/src/hooks/runner.ts
      scanHooks(event) → finds .maina/hooks/<event>.sh
      executeHook(path, context) → spawns process, pipes JSON on stdin
      Exit code 0 = continue, 2 = block, other = warn and continue
- [ ] Test: pre-commit hook with exit 0 passes; exit 2 blocks
```

**T002 — Tool auto-detection**
```
- [ ] packages/core/src/verify/detect.ts
      detectTools() → checks PATH for: biome, semgrep, trivy,
      secretlint, sonarqube, stryker
      Returns: { name, version, available }[]
- [ ] Test: detects biome (installed), skips trivy (not installed)
```

**T003 — Syntax guard**
```
- [ ] packages/core/src/verify/syntax-guard.ts (see pattern above)
- [ ] Runs Biome check on staged files
- [ ] Returns Result<void, SyntaxError[]>
- [ ] Test: valid file passes; file with missing bracket rejects
```

**T004 — Slop detector**
```
- [ ] packages/core/src/verify/slop.ts
- [ ] AST-based (tree-sitter): empty bodies, hallucinated imports
- [ ] Pattern-based: console.log, TODO without ticket, commented-out blocks
- [ ] Cache integration: same file hash → same result
- [ ] Test: file with console.log → detected; file without → clean
```

**T005 — Semgrep + Trivy + Secretlint integration**
```
- [ ] packages/core/src/verify/semgrep.ts — run with auto rules + custom rules/
      Parse SARIF output into unified Finding type
- [ ] packages/core/src/verify/trivy.ts — dependency CVEs
- [ ] packages/core/src/verify/secretlint.ts — secrets detection
- [ ] Test: each tool returns Finding[] or skips gracefully
```

**T006 — Diff-only filter**
```
- [ ] packages/core/src/verify/diff-filter.ts (see pattern above)
- [ ] Filters findings to only changed lines
- [ ] Returns { shown, hidden } count
- [ ] Test: finding on unchanged line → hidden;
        finding on changed line → shown
```

**T007 — AI fix generation**
```
- [ ] packages/core/src/verify/fix.ts
- [ ] Takes: Finding + context (from Context Engine) + prompt (from Prompt Engine)
- [ ] Checks cache first (same finding hash → instant fix)
- [ ] Generates fix as diff, validates compilation
- [ ] Test: known finding → generates valid fix; same finding again → cache hit
```

**T008 — Verify pipeline orchestrator**
```
- [ ] packages/core/src/verify/pipeline.ts
- [ ] Parallel execution with runtime.NumCPU() concurrency
- [ ] Auto-detects tools, skips unavailable
- [ ] Applies diff-only filter
- [ ] Unified report: terminal table with @clack/prompts
- [ ] --json flag for CI, --all flag for full repo scan
- [ ] Test: pipeline runs 3 tools in parallel, produces unified result
```

**T009 — CLI: `maina commit`**
```
- [ ] packages/cli/src/commands/commit.ts
- [ ] Flow: hooks(pre-commit) → staged files → syntax guard →
      parallel gates (typecheck, test, slop) → commitlint → git commit →
      hooks(post-commit)
- [ ] Records all results in feedback.db
- [ ] Updates working context with result
- [ ] Test: clean code commits; broken syntax rejects before tests run
```

**T010 — CLI: `maina verify` + `maina doctor`**
```
- [ ] maina verify: full pipeline, diff-only default, --fix shows AI fixes
- [ ] maina doctor: installed tools, missing tools, engine health, cache stats
- [ ] Test: verify produces unified report; doctor shows all tools
```

### Delegation prompt
```
Read PRODUCT_SPEC.md and IMPLEMENTATION_PLAN.md Sprint 3.

Build the Verify Engine and `maina commit`.

Start with ALL tests from the TDD contract.

Critical architectural patterns:
1. Syntax guard runs FIRST, before all other gates (SWE-agent pattern).
   If syntax fails, REJECT immediately — no tests, no coverage, no slop.
2. Diff-only filtering by default (Reviewdog pattern).
   Only show findings on changed lines. Hide pre-existing issues.
3. AI fixes use Context Engine for surrounding code + Prompt Engine
   for team-tuned prompts + Cache for dedup.
4. Lifecycle hooks: execute .maina/hooks/pre-commit.sh before gates,
   .maina/hooks/post-commit.sh after success.

Wire `maina commit` as the git commit wrapper. From this sprint onward,
every commit to Maina goes through `maina commit`.

Use TodoWrite to track all 10 tasks. Fresh subagent per task.
Two-stage review after each.
```

---

## Sprint 4 — Features + `maina plan` + `maina spec`

**Goal:** Structured features directory. TDD scaffolding from plans.

### Prompt examples from research

**Spec Kit's automatic feature numbering:**
```python
# From spec-kit — scans existing features for next number
def get_next_feature_number(specs_dir):
    existing = sorted(glob(f"{specs_dir}/*/"))
    if not existing:
        return "001"
    last = int(os.path.basename(existing[-1]).split("-")[0])
    return f"{last + 1:03d}"
```

**Spec Kit's WHAT/WHY vs HOW separation:**
```markdown
<!-- spec.md — WHAT and WHY only -->
# Feature: User Authentication

## User stories
- As a user, I want to log in with email/password
- As a user, I want to reset my forgotten password

## Acceptance criteria
- Login form validates email format
- Failed login shows specific error message
- Password reset sends email within 30 seconds

## [NEEDS CLARIFICATION]
- Should we support OAuth providers? Which ones?
- What is the session timeout duration?

<!-- plan.md — HOW only -->
# Implementation Plan

## Architecture
- Keycloak for auth provider
- JWT with RS256 signing
- Refresh token rotation

## Tasks
- T001: Configure Keycloak realm
- T002: Implement login endpoint
- T003: Implement token refresh
```

**Superpowers' plan verification checklist:**
```markdown
After writing the plan, self-check:
1. Spec coverage: every acceptance criterion maps to a task
2. Placeholder scan: no TODO/TBD markers in the plan
3. Type consistency: function names in later tasks match earlier definitions
4. Test-first ordering: every impl task has a preceding test task
```

### Tasks

**T001 — Feature numbering + directory management**
```
- [ ] packages/core/src/features/numbering.ts
      getNextFeatureNumber() → scans .maina/features/, returns "001", "002"...
      createFeatureDir(number, name) → creates .maina/features/001-name/
      scaffoldFeature(dir) → creates spec.md, plan.md, tasks.md templates
- [ ] Test: empty dir → 001; existing 001, 002 → 003
```

**T002 — Plan verification checklist**
```
- [ ] packages/core/src/features/checklist.ts
      verifyPlan(planPath, specPath) → deterministic checks:
      - Every spec acceptance criterion has a matching task
      - No TODO/TBD/PLACEHOLDER markers
      - Function/type names consistent across tasks
      - Test tasks precede implementation tasks
- [ ] Test: plan missing a spec criterion → fails with specific message
```

**T003 — Cross-artifact consistency analyzer**
```
- [ ] packages/core/src/features/analyzer.ts
      analyze(featureDir) → checks spec ↔ plan ↔ tasks consistency
      Partly deterministic (structure), partly AI (semantic)
      Flags: missing requirements, orphaned tasks, contradictions
- [ ] Test: plan with task not in spec → flagged as orphaned
```

**T004 — CLI: `maina plan`**
```
- [ ] Creates branch with auto-numbered feature name
- [ ] Generates PLAN.md from Context Engine (semantic + working)
- [ ] Enforces WHAT/WHY in spec.md, HOW in plan.md
- [ ] Runs plan verification checklist before commit
- [ ] Commits as first commit on feature branch
- [ ] Test: maina plan creates branch, scaffolds feature dir, commits PLAN.md
```

**T005 — CLI: `maina spec`**
```
- [ ] Reads PLAN.md, generates TDD test stubs
- [ ] Uses Prompt Engine with team's test conventions
- [ ] describe/it blocks with [NEEDS CLARIFICATION] for ambiguous cases
- [ ] Commits as second commit on feature branch
- [ ] Test: maina spec produces test file with stubs matching plan tasks
```

**T006 — CLI: `maina analyze`**
```
- [ ] Runs cross-artifact consistency check
- [ ] Reports: missing coverage, orphaned tasks, contradictions
- [ ] Can run standalone or as part of maina verify
- [ ] Test: inconsistent spec/plan → analyze reports specific gap
```

### Delegation prompt
```
Read PRODUCT_SPEC.md and IMPLEMENTATION_PLAN.md Sprint 4.

Build structured features with plan verification.

Key patterns from Spec Kit:
1. Auto-numbered features (.maina/features/001-name/)
2. WHAT/WHY in spec.md, HOW in plan.md — strictly separated
3. [NEEDS CLARIFICATION] markers for ambiguity — never guess
4. Plan verification checklist: deterministic, no AI needed
5. Cross-artifact consistency: maina analyze checks spec ↔ plan ↔ tasks

Use TodoWrite to track all 6 tasks. Fresh subagent per task.
```

---

## Sprint 5 — Define commands

**Goal:** `maina ticket`, `maina design`, `maina explain`, `maina review design`.

### Tasks

**T001** — `maina ticket`: GitHub Issues via @octokit/rest, Context Engine provides module tagging
**T002** — `maina design`: Scaffolds ADR in `adr/`, MADR format, WHAT/WHY only
**T003** — `maina review design`: AI reviews ADR against existing ADRs + constitution
**T004** — `maina explain`: Mermaid diagrams from dependency graph, LLM summary (cached)

### Delegation prompt
```
Read PRODUCT_SPEC.md and IMPLEMENTATION_PLAN.md Sprint 5.
Build the Define phase commands. All use Context Engine + Prompt Engine.
maina design produces WHAT/WHY docs. maina review design checks against
constitution and existing ADRs. 4 tasks, fresh subagent per task.
```

---

## Sprint 6 — `maina pr` + `maina init`

**Goal:** Two-stage PR review. Full bootstrapping.

### Prompt examples from research

**Superpowers' two-stage review:**
```markdown
# Stage 1: Spec compliance reviewer
You are reviewing code changes against the implementation plan.

Read the plan at: {{plan_path}}
Read the diff: {{diff}}

Answer these questions:
1. Does every task in the plan have corresponding code changes?
2. Are there code changes that weren't in the plan? (over-building)
3. Are there plan requirements with no corresponding code?

Do NOT evaluate code quality. Only spec compliance.

# Stage 2: Code quality reviewer (only runs if Stage 1 passes)
You are reviewing code quality ONLY.

The code has already been verified as spec-compliant.
Review for: clean code, test coverage, maintainability, security.
Use the team's conventions: {{conventions}}
```

### Tasks

**T001** — Two-stage PR review (spec compliance → code quality)
**T002** — `maina pr`: create PR via Octokit, auto-description, trigger verify, link issue
**T003** — `maina init`: bootstraps .maina/, constitution, AGENTS.md, default prompts, lefthook, CI workflow
**T004** — `maina status`: current branch verification from working context

### Delegation prompt
```
Read PRODUCT_SPEC.md and IMPLEMENTATION_PLAN.md Sprint 6.
Build maina pr with TWO-STAGE review (Superpowers pattern):
Stage 1 checks spec compliance against PLAN.md.
Stage 2 checks code quality — only runs if Stage 1 passes.
Build maina init to bootstrap Maina in any repo in under 2 minutes.
Test the full 10-step workflow end-to-end on the Maina repo itself.
```

---

## Sprint 7 — MCP Server

**Goal:** Maina MCP server works in Cursor, Claude Code, Continue.dev.

### Tasks

**T001** — MCP server scaffold: @modelcontextprotocol/sdk, stdio, `maina --mcp`
**T002** — MCP tools: each delegates to the appropriate engine, all cache-aware
**T003** — IDE testing: verify in Cursor + Claude Code, document setup

### Delegation prompt
```
Read PRODUCT_SPEC.md and IMPLEMENTATION_PLAN.md Sprint 7.
Build the MCP server. Each tool delegates to an engine.
All responses go through cache. Test in Cursor and Claude Code.
```

---

## Sprint 8 — RL Feedback Loop + Skills

**Goal:** Full feedback loop. Prompts evolve. Skills package ships.

### Tasks

**T001** — Feedback collection: every AI output logs prompt hash, outcome, modification
**T002** — Preference learning: per-rule false positive rates → preferences.json
**T003** — Prompt evolution: maina learn analyses, proposes, A/B tests
**T004** — Episodic compression: accepted reviews → few-shot examples in episodic layer
**T005** — Skills package: SKILL.md files for Claude Code/Cursor/Codex
**T006** — Skills testing: verify skills trigger from naive prompts

### Delegation prompt
```
Read PRODUCT_SPEC.md and IMPLEMENTATION_PLAN.md Sprint 8.
Wire the full RL feedback loop. Every AI interaction logs to feedback.db.
maina learn analyses patterns and manages A/B testing.

Also build the Skills package — SKILL.md files that teach any AI agent
the Maina verification workflow. Skills use progressive disclosure:
~100 tokens for metadata, <5k when activated.
Test that skills trigger automatically from naive prompts like
"help me plan this feature" without mentioning Maina.
```

---

## Sprint 9 — Spec Quality + Verification Discipline (Karpathy Principles)

**Goal:** Make maina's spec/plan system world-class by applying Karpathy's core principles: measure everything, verify every claim, iterate with tight feedback loops, and treat specs as training data — garbage in, garbage out.

### Philosophy

Andrej Karpathy's approach to building reliable systems applies directly to specification quality:

1. **"The most dangerous thing is a slightly wrong answer"** — A spec that seems complete but has gaps is worse than no spec. Maina must catch the gaps deterministically.
2. **"You need to stare at your data"** — Specs are the "training data" for implementation. If the spec is vague, the code will hallucinate.
3. **"Start with the simplest thing, measure, iterate"** — Every spec should have measurable acceptance criteria. If you can't write a test for it, the requirement isn't clear enough.
4. **"Loss curves don't lie"** — Track spec quality metrics over time. Are plans getting more consistent? Are fewer orphaned tasks appearing? Is the verify-skip rate dropping?

### Tasks

**T001 — Rationalization prevention system**
```
- [ ] packages/core/src/verify/discipline.ts
      Track skip events: when --skip or --no-verify is used on maina commit,
      log it as a "discipline violation" in stats.db
      skipRate = skips / totalCommits — shown in maina stats
      If skipRate > 20%, maina stats shows a warning
- [ ] Test: 5 commits with 2 skips → skipRate 40% → warning shown
```

**T002 — Red-green enforcement for maina spec**
```
- [ ] After maina spec generates test stubs, automatically run them
      Verify ALL stubs fail (red phase). If any pass, flag as "test not
      testing anything useful — rewrite"
      This catches the Karpathy principle: "a test that passes immediately
      proves nothing"
- [ ] Test: generated stubs all have expect(true).toBe(false) → all red → pass
        Modified stub that passes → flagged as suspicious
```

**T003 — Spec quality scoring**
```
- [ ] packages/core/src/features/quality.ts
      scoreSpec(specPath) → QualityReport with:
      - measurability: % of acceptance criteria that contain measurable verbs
        (validates, returns, creates, sends, rejects) vs vague verbs
        (handles, manages, supports, processes)
      - completeness: ratio of [NEEDS CLARIFICATION] markers to total criteria
      - testability: can each criterion be expressed as a test assertion?
      - ambiguity: count of weasel words (might, maybe, should, could, etc.)
      Overall score 0-100. Below 60 = warning. Below 40 = block.
- [ ] Test: spec with "validates email format" scores high;
        spec with "handles authentication" scores low
```

**T004 — Plan-to-code traceability**
```
- [ ] packages/core/src/features/traceability.ts
      After implementation, verify each plan task has corresponding:
      - Test file (by task number in test name or file name)
      - Implementation file (by function/type names from plan)
      - Commit (by conventional commit message referencing task)
      Missing traceability = warning in maina analyze
- [ ] Test: plan with T001-T003, commits reference T001 and T003 →
        T002 flagged as untraced
```

**T005 — Spec evolution metrics in maina stats**
```
- [ ] Track per-feature: initial spec score, final spec score,
      analyze findings at creation vs at merge
      Show improvement trend: "Specs improving: avg score 45 → 72 over 5 features"
- [ ] maina stats --specs shows spec-specific metrics
```

**T006 — Stop conditions for maina commit**
```
- [ ] If maina analyze finds errors (not warnings) on current feature,
      maina commit shows a warning: "Feature 001-stats-tracker has 3 spec
      consistency errors. Run maina analyze to review."
      Does NOT block — just warns. User can always proceed.
      Configurable: .maina/preferences.json { "analyzeOnCommit": true }
- [ ] Test: feature with spec errors → warning shown on commit;
        clean feature → no warning
```

### Delegation prompt
```
Read PRODUCT_SPEC.md and IMPLEMENTATION_PLAN.md Sprint 9.

Build Karpathy-principled verification into maina's spec/plan system.
Core insight: specs are training data — quality in = quality out.

Key deliverables:
1. Rationalization prevention (skip tracking + warnings)
2. Red-green enforcement (spec stubs must fail)
3. Spec quality scoring (measurability, testability, ambiguity)
4. Plan-to-code traceability (every task → test + code + commit)
5. Evolution metrics (are specs improving over time?)
6. Stop conditions (analyze warnings on commit)

Compare against Superpowers' TDD and verification-before-completion
skills — steal the discipline, automate the checks.

Use maina plan + maina spec to scaffold this sprint.
6 tasks, fresh subagent per task.
```

---

## Sprint 10 — Publish

**Pre-requisite:** Push repo to GitHub before this sprint. `git remote add origin <url> && git push -u origin master`.

**T001** — npm package: `bunx maina --version` works globally
**T002** — Single binary: `bun build --compile`, GitHub Release (macOS + Linux)
**T003** — Homebrew formula
**T004** — Docusaurus docs: quickstart, commands, config, MCP, custom prompts, Semgrep rules
**T005** — README with quickstart, demo GIF, badges
**T006** — Dogfood comparison report: `maina stats` data from all sprints, Claude+Superpowers vs Claude+Maina metrics

---

## Sprint 11 — Launch

**T001** — Show HN, dev.to article
**T002** — GitHub Discussions, issue templates, CONTRIBUTING.md
**T003** — Post-launch iteration from community feedback

---

## Dogfooding checkpoints

| Sprint | Dogfood with | Key question |
|--------|-------------|-------------|
| 1 | `maina context` on Maina repo | Does PageRank rank engine.ts higher than README? |
| 2 | `maina cache stats` after a week | What's the real cache hit rate? |
| 3 | `maina commit` for every commit | Which gates are noisy? How fast is syntax guard? |
| 4 | `maina plan` + `maina spec` | Do test stubs match how you actually think about tests? |
| 5 | Full define phase | Does Context Engine provide useful module tagging? |
| 6 | Full 10-step workflow | What's total friction vs manual? |
| 7 | MCP in Cursor | Does `getContext` eliminate context-switching? |
| 8 | `maina learn` after 8 weeks | Do evolved prompts outperform originals? |
| 9 | `maina stats --specs` after 5+ features | Are spec quality scores trending up? Is skip rate below 10%? |
| 10 | `bunx maina` on a fresh repo | Can a new user go from zero to verified commit in 2 minutes? |
