/**
 * Terminal keyframe script — pure data, rendered to static DOM at build time.
 *
 * No runtime library. Each `Frame` is a line in the terminal that will be
 * revealed by a CSS keyframe at time `t` (seconds, absolute from animation
 * start). The parent animation clock drives every frame's reveal.
 *
 * Hero (`heroFrames`): ~52s loop, tight, four segments — setup, context,
 * verify, commit — with a 3s pause at the end before restart.
 *
 * Full-width (`fullFrames`): ~90s, slower, annotated, scrubbable with
 * chapter markers matching `landing.ts.TERMINAL_SECTION.chapters`.
 *
 * ─── Drafting note ──────────────────────────────────────────────────────
 * The outputs here are modelled on real `maina` behaviour (tool names, exit
 * codes, step ordering) but the exact numbers are illustrative. Before
 * shipping, regenerate these from a captured run of `maina setup &&
 * maina context … && maina verify && maina commit` on the reference repo
 * (see `scripts/capture-terminal-script.ts`, follow-up task).
 */

export type FrameKind = "input" | "output" | "header" | "ok" | "warn" | "err";

export interface Frame {
	/** Seconds from animation start. Strictly increasing per array. */
	t: number;
	kind: FrameKind;
	text: string;
	/** Optional caption shown next to the line (full-width only). */
	annotation?: string;
	/** Optional chapter this frame belongs to — drives scrubbable timeline. */
	chapter?: "context" | "constitution" | "verify" | "commit-proof";
}

// ─── Hero (52s) ─────────────────────────────────────────────────────────

export const heroFrames: Frame[] = [
	// 0–8s · setup
	{ t: 0.0, kind: "input", text: "$ bunx @mainahq/cli@latest setup" },
	{ t: 1.2, kind: "output", text: "┌  maina setup" },
	{ t: 2.0, kind: "output", text: "│  Detected monorepo · TypeScript · bun" },
	{
		t: 3.4,
		kind: "output",
		text: "│  Indexing 1,248 files · tree-sitter AST · PageRank",
	},
	{ t: 5.8, kind: "ok", text: "│  ✓ wiki compiled · 588 articles · 7.6s" },
	{
		t: 6.8,
		kind: "ok",
		text: "│  ✓ MCP server registered with Claude Code, Cursor",
	},
	{ t: 7.6, kind: "output", text: "└  Ready." },

	// 8–20s · context
	{ t: 9.2, kind: "input", text: "$ maina context ./src/auth.ts" },
	{ t: 10.2, kind: "output", text: "┌  maina context" },
	{ t: 10.9, kind: "output", text: "│  working set  ████████ 1.1k" },
	{ t: 11.4, kind: "output", text: "│  PR memory    ██       0.3k" },
	{ t: 11.9, kind: "output", text: "│  AST+PageRank ████     0.6k" },
	{ t: 12.4, kind: "output", text: "│  code search  ███      0.5k" },
	{
		t: 13.2,
		kind: "output",
		text: "│  ─────────────────────────────",
	},
	{
		t: 13.8,
		kind: "ok",
		text: "│  budget: 3.4k / 8k tokens   (was 11.2k before maina)",
	},
	{ t: 15.6, kind: "ok", text: "│  ✓ context bundle written" },
	{
		t: 16.6,
		kind: "output",
		text: "└  Paste into your agent, or let the MCP server serve it.",
	},

	// 20–38s · verify
	{ t: 20.6, kind: "input", text: "$ maina verify" },
	{ t: 21.4, kind: "output", text: "┌  maina verify" },
	{ t: 22.2, kind: "output", text: "│  syntax guard  ✓  biome" },
	{ t: 23.0, kind: "ok", text: "│  ✓ semgrep          7.1s" },
	{ t: 23.6, kind: "ok", text: "│  ✓ trivy            2.8s" },
	{ t: 24.2, kind: "ok", text: "│  ✓ secretlint       0.4s" },
	{ t: 24.8, kind: "ok", text: "│  ✓ sonar            4.2s" },
	{ t: 25.4, kind: "ok", text: "│  ✓ diff-cover       0.9s" },
	{ t: 26.0, kind: "ok", text: "│  ✓ stryker          6.7s" },
	{ t: 26.6, kind: "ok", text: "│  ✓ slop detector    0.2s" },
	{ t: 27.2, kind: "ok", text: "│  ✓ doc-claims       0.3s" },
	{ t: 27.8, kind: "ok", text: "│  ✓ typecheck        3.1s" },
	{ t: 28.4, kind: "ok", text: "│  ✓ tests            2.4s" },
	{
		t: 29.4,
		kind: "output",
		text: "│  ─────────────────────────────",
	},
	{
		t: 30.0,
		kind: "output",
		text: "│  AI fix     · 0 issues after diff-only filter",
	},
	{
		t: 31.2,
		kind: "ok",
		text: "│  ✓ review stage 1 · spec compliance",
	},
	{
		t: 32.4,
		kind: "ok",
		text: "│  ✓ review stage 2 · code quality",
	},
	{ t: 33.6, kind: "output", text: "└  13 tools · 0 findings · 12.1s" },

	// 38–49s · commit
	{ t: 38.4, kind: "input", text: "$ maina commit -m 'feat(core): …'" },
	{ t: 39.2, kind: "output", text: "┌  maina commit" },
	{ t: 40.0, kind: "output", text: "│  re-verifying staged diff …" },
	{ t: 41.8, kind: "ok", text: "│  ✓ verified · 13 tools · 0 findings" },
	{
		t: 43.0,
		kind: "ok",
		text: "│  ✓ proof attached: sha256:a1f2…e7c9",
	},
	{
		t: 44.2,
		kind: "output",
		text: "│  [master 5c0f3d1] feat(core): …",
	},
	{
		t: 45.4,
		kind: "ok",
		text: "└  Committed. Run `maina stats` to see the effect over time.",
	},

	// 49–52s · hold before loop
	{ t: 49.0, kind: "output", text: "$" },
];

// ─── Full-width (~90s, annotated) ───────────────────────────────────────

export const fullFrames: Frame[] = [
	// Chapter: context (0–28s)
	{
		t: 0.0,
		kind: "header",
		text: "~ fresh clone of mainahq/example-ts ~",
		chapter: "context",
	},
	{
		t: 1.2,
		kind: "input",
		text: "$ bunx @mainahq/cli@latest setup",
		chapter: "context",
		annotation: "one command, no API key",
	},
	{ t: 2.6, kind: "output", text: "┌  maina setup", chapter: "context" },
	{
		t: 4.0,
		kind: "output",
		text: "│  tree-sitter · 12 languages detected (ts, tsx, js, py, go)",
		chapter: "context",
	},
	{
		t: 6.2,
		kind: "output",
		text: "│  building knowledge graph · 1,248 files",
		chapter: "context",
		annotation: "AST + PageRank, not vector similarity",
	},
	{
		t: 9.4,
		kind: "output",
		text: "│  running leiden-connected community detection",
		chapter: "context",
	},
	{
		t: 12.6,
		kind: "ok",
		text: "│  ✓ wiki compiled · 588 articles · 7.6s",
		chapter: "context",
	},
	{
		t: 14.8,
		kind: "ok",
		text: "│  ✓ MCP server registered (claude-code, cursor, windsurf)",
		chapter: "context",
	},
	{ t: 17.0, kind: "output", text: "└  Ready.", chapter: "context" },
	{
		t: 19.8,
		kind: "input",
		text: "$ maina context ./src/auth.ts",
		chapter: "context",
		annotation: "ask for the context your agent would need",
	},
	{
		t: 21.4,
		kind: "ok",
		text: "│  budget: 3.4k / 8k tokens  ← was 11.2k before maina",
		chapter: "context",
		annotation: "−70% prompt size",
	},
	{
		t: 24.6,
		kind: "ok",
		text: "│  ✓ context bundle written to stdout",
		chapter: "context",
	},

	// Chapter: constitution (28–42s)
	{
		t: 28.0,
		kind: "input",
		text: "$ cat .maina/constitution.md",
		chapter: "constitution",
		annotation: "your project DNA, versioned",
	},
	{
		t: 29.6,
		kind: "output",
		text: "# Maina Constitution",
		chapter: "constitution",
	},
	{
		t: 30.8,
		kind: "output",
		text: "- TDD always. Write the test first.",
		chapter: "constitution",
	},
	{
		t: 32.0,
		kind: "output",
		text: "- Error handling: Result<T, E>, never throw.",
		chapter: "constitution",
	},
	{
		t: 33.2,
		kind: "output",
		text: "- Diff-only findings. Never report untouched lines.",
		chapter: "constitution",
	},
	{
		t: 35.6,
		kind: "output",
		text: "- …",
		chapter: "constitution",
	},
	{
		t: 37.4,
		kind: "output",
		text: "│  hashed, cached, A/B scaffold ready",
		chapter: "constitution",
		annotation: "same rule, every run, every model",
	},

	// Chapter: verify (42–72s)
	{
		t: 42.0,
		kind: "input",
		text: "$ maina verify",
		chapter: "verify",
		annotation: "19 tools, diff-only, parallel",
	},
	{ t: 43.8, kind: "output", text: "┌  maina verify", chapter: "verify" },
	{
		t: 45.0,
		kind: "output",
		text: "│  syntax guard  ✓  biome 0.31s",
		chapter: "verify",
	},
	{ t: 46.4, kind: "ok", text: "│  ✓ semgrep       7.1s", chapter: "verify" },
	{ t: 47.2, kind: "ok", text: "│  ✓ trivy         2.8s", chapter: "verify" },
	{ t: 48.0, kind: "ok", text: "│  ✓ secretlint    0.4s", chapter: "verify" },
	{ t: 48.8, kind: "ok", text: "│  ✓ sonar         4.2s", chapter: "verify" },
	{ t: 49.6, kind: "ok", text: "│  ✓ diff-cover    0.9s", chapter: "verify" },
	{ t: 50.4, kind: "ok", text: "│  ✓ stryker       6.7s", chapter: "verify" },
	{ t: 51.2, kind: "ok", text: "│  ✓ slop          0.2s", chapter: "verify" },
	{ t: 52.0, kind: "ok", text: "│  ✓ doc-claims    0.3s", chapter: "verify" },
	{ t: 52.8, kind: "ok", text: "│  ✓ typecheck     3.1s", chapter: "verify" },
	{ t: 53.6, kind: "ok", text: "│  ✓ tests         2.4s", chapter: "verify" },
	{
		t: 55.0,
		kind: "output",
		text: "│  ────── diff-only filter: 0 findings outside changed lines ──────",
		chapter: "verify",
		annotation: "no drive-by noise",
	},
	{
		t: 58.4,
		kind: "ok",
		text: "│  ✓ review stage 1 · spec compliance",
		chapter: "verify",
	},
	{
		t: 61.8,
		kind: "ok",
		text: "│  ✓ review stage 2 · code quality",
		chapter: "verify",
	},
	{
		t: 65.0,
		kind: "output",
		text: "└  13 tools · 0 findings · 12.1s",
		chapter: "verify",
	},

	// Chapter: commit-proof (72–90s)
	{
		t: 72.0,
		kind: "input",
		text: "$ maina commit",
		chapter: "commit-proof",
		annotation: "re-verify staged diff, attach proof",
	},
	{
		t: 73.8,
		kind: "ok",
		text: "│  ✓ verified · 13 tools · 0 findings",
		chapter: "commit-proof",
	},
	{
		t: 75.6,
		kind: "ok",
		text: "│  ✓ proof attached: sha256:a1f2b03c…e7c9",
		chapter: "commit-proof",
	},
	{
		t: 77.4,
		kind: "output",
		text: "│  [master 5c0f3d1] feat(core): add JWT verifier",
		chapter: "commit-proof",
	},
	{
		t: 80.0,
		kind: "ok",
		text: "└  Committed. Reviewer sees the proof, not a claim.",
		chapter: "commit-proof",
		annotation: "every commit carries its own receipt",
	},
];
