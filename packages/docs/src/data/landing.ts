/**
 * Landing-page copy — single source of truth.
 *
 * Every string on `/` originates here. `spec.md §Final copy (locked)` is the
 * contract: engineers do not retype these lines in markup. A CI grep check
 * (T9.5) fails the build if any locked string leaks into a component.
 *
 * See `.maina/features/050-landing-revamp/spec.md` for WHY each line reads
 * the way it does.
 */

/** Change in one place; propagates to every install-line appearance
 *  on the page AND to the terminal demo's input frames. */
export const INSTALL_COMMAND = "bunx @mainahq/cli@latest setup" as const;

/** Same string, prefixed with the shell prompt — what the terminal
 *  animation echoes as its first input line. */
export const INSTALL_PROMPT = `$ ${INSTALL_COMMAND}` as const;

/** Meta / SEO. */
export const META = {
	title:
		"Maina — your AI keeps sending the wrong context. That's why it's slopping out broken code.",
	description:
		"Maina is a verification-first developer OS. It rebuilds the context your AI should have been using, runs a 19-tool pipeline on every diff, and proves the change is correct before it merges. Works with Claude Code, Cursor, Windsurf, Copilot, Codex, Gemini CLI. Free and open source.",
	// Set to a real path (e.g. "/og/og-landing-v2.png") once the asset
	// is generated via scripts/generate-og.ts. Until then we skip the
	// og:image meta tag rather than point at a 404.
	ogImage: null as string | null,
	url: "https://mainahq.com/",
} as const;

/** Nav labels. Keep in sync with the header rendered in index.astro. */
export const NAV = {
	brand: "Maina.",
	links: [
		{ label: "Docs", href: "/quickstart" },
		{ label: "Commands", href: "/commands" },
		{ label: "Wiki", href: "/wiki" },
		{ label: "Cloud", href: "/cloud" },
		{ label: "GitHub", href: "https://github.com/mainahq/maina" },
	],
} as const;

/** Hero. */
export const HERO = {
	eyebrow:
		"// 41% of your codebase was written by an AI that had no idea what the other 59% does.",
	headlineLine1: "Your AI is guessing.",
	headlineLine2:
		"Maina gives it the context it was missing — and proves the diff is correct before it merges.",
	sub: "Every prompt, your coding agent burns 8–12k tokens pasting files it hopes are relevant. Most of them aren't. Maina runs a 4-layer context engine over your repo — working set, PR memory, AST + PageRank, code search — and hands your agent only what matters. Then a 19-tool verification pipeline checks the diff before it merges. Run it on your repo in 60 seconds. No account, no API key, no config.",
	installCommand: INSTALL_COMMAND,
	affordances: [
		{
			kind: "scroll",
			label: "▸ watch a 60-second run",
			target: "#terminal",
		},
		{
			kind: "link",
			label: "★ 250+ self-verified commits on GitHub",
			href: "https://github.com/mainahq/maina/commits/master",
		},
		{
			kind: "text",
			label: "MIT, runs locally, no telemetry by default",
		},
	],
} as const;

/** Pain strip — the three moments of recognition. */
export const PAIN_STRIP = {
	cards: [
		{
			label: "// 11:47pm",
			body: "Your agent rewrote the auth handler using an API that doesn't exist in your version of the SDK.",
		},
		{
			label: "// $412 last month",
			body: "Half your Claude bill was context you pasted twice because the agent forgot it.",
		},
		{
			label: "// commit e4a1f92",
			body: 'The review bot said "LGTM." Prod said otherwise.',
		},
	],
	cap: "Maina is the layer that makes those three things stop.",
} as const;

/** Full-width terminal section. */
export const TERMINAL_SECTION = {
	header: "60 seconds, start to finish.",
	sub: "No edited video, no marketing demo. This is `maina setup` on a fresh clone of a real TypeScript repo, verified by the bytes you can run yourself.",
	chapters: [
		{ id: "context", label: "context" },
		{ id: "constitution", label: "constitution" },
		{ id: "verify", label: "verify" },
		{ id: "commit-proof", label: "commit proof" },
	],
	reproduceLinePrefix: "▸ reproduce locally:",
	installCommand: INSTALL_COMMAND,
} as const;

/** Engines section. Each card has prose, one hard number, and an ADR link set. */
export const ENGINES = {
	header: "Three engines. One honest claim each.",
	cards: [
		{
			id: "context",
			name: "Context Engine",
			claim: "Your agent sees the files that matter. Not the ones that fit.",
			detail:
				"4 layers — working set, PR memory with Ebbinghaus decay, tree-sitter AST + PageRank, Zoekt-indexed code search. Token budget adapts to the task: 40% focused, 60% default, 80% explore. On our own repo, this cut average prompt size from 11.2k → 3.4k tokens without losing accuracy.",
			proof: "Proof: ADR-0004, ADR-0017, benchmark report.",
			proofLinks: [
				{ label: "ADR-0004", href: "/adr/0004" },
				{ label: "ADR-0017", href: "/adr/0017" },
				{ label: "benchmark report", href: "/benchmarks/context-reduction" },
			],
		},
		{
			id: "prompt",
			name: "Prompt Engine",
			claim:
				"Your rules, versioned, hashed, A/B tested. Not a vibes folder of scattered .cursorrules.",
			detail:
				"One constitution (stable project DNA, never A/B tested). Custom prompts per command. Every run is keyed on prompt version + context hash + model + input — the same query never hits the AI twice. Local cache hit rate on our team: 41%.",
			proof: "Proof: ADR-0001.",
			proofLinks: [{ label: "ADR-0001", href: "/adr/0001" }],
		},
		{
			id: "verify",
			name: "Verify Engine",
			claim:
				"Every diff runs a 19-tool pipeline before it lands. We run it on Maina itself, on every commit. There are 250+ of them.",
			detail:
				"Syntax guard (Biome, <500ms) → parallel deterministic tools (Semgrep, Trivy, Secretlint, SonarQube, diff-cover, Stryker, slop detector) → diff-only filter → AI fix → two-stage review: spec compliance, then code quality. Diff-only: we only report findings on the lines that changed.",
			proof: "Proof: ADR-0002, ADR-0008, 1,167+ passing tests.",
			proofLinks: [
				{ label: "ADR-0002", href: "/adr/0002" },
				{ label: "ADR-0008", href: "/adr/0008" },
				{
					label: "1,167+ passing tests",
					href: "https://github.com/mainahq/maina/actions",
				},
			],
		},
	],
} as const;

/** ProofStrip receipts. */
export const PROOF_STRIP = {
	stats: [
		{
			value: "250+",
			label: "commits, every one self-verified by `maina commit`",
			href: "https://github.com/mainahq/maina/commits/master",
		},
		{
			value: "1,167+",
			label: "passing tests across 7 languages",
			href: "https://github.com/mainahq/maina/actions",
		},
		{
			value: "19",
			label: "tools in the verify pipeline",
			href: "/adr/0002",
		},
		{
			value: "41%",
			label: "average context-token reduction on our own repo",
			href: "/benchmarks/context-reduction",
		},
		{
			value: "0",
			label: "API keys required to try it",
			href: "#install",
		},
	],
} as const;

/** StackFit — tool logos in alphabetical order (spec §7). */
export const STACK_FIT = {
	header: "Whatever you already use. Maina sits under it.",
	tools: [
		{ name: "Claude Code", tooltip: "MCP server + CLI integration" },
		{ name: "Cline", tooltip: "MCP server" },
		{ name: "Codex", tooltip: "MCP server" },
		{ name: "Continue", tooltip: "MCP server" },
		{ name: "Copilot", tooltip: "VS Code extension bridge" },
		{ name: "Cursor", tooltip: "MCP server + rules" },
		{ name: "Gemini CLI", tooltip: "MCP server" },
		{ name: "OpenHands", tooltip: "MCP server" },
		{ name: "Roo Code", tooltip: "MCP server" },
		{ name: "Windsurf", tooltip: "MCP server" },
		{ name: "Zed AI", tooltip: "MCP server" },
	],
	plus: "+ any MCP client",
	caption:
		"Maina ships as a CLI and as an MCP server. Your coding agent calls it. You don't change your workflow.",
} as const;

/** Comparison matrix. */
export const COMPARISON = {
	header: "What this replaces.",
	columns: [
		{ id: "diff-only", label: "Diff-only" },
		{ id: "multi-language", label: "Multi-language" },
		{ id: "learns-from-feedback", label: "Learns from feedback" },
		{ id: "self-verified", label: "Self-verified" },
		{ id: "cost", label: "Cost" },
	],
	rows: [
		{
			name: "Maina",
			cells: ["✓", "7 languages", "✓", "✓", "Free"],
			highlighted: true,
		},
		{
			name: "CodeRabbit",
			cells: ["Partial", "Multi-language", "✗", "✗", "$15+/mo"],
		},
		{
			name: "DeepSource",
			cells: ["Partial", "Multi-language", "✗", "✗", "$12+/mo"],
		},
		{
			name: "Manual review",
			cells: ["Human-only", "n/a", "✗", "✗", "Your time"],
		},
		// [NEEDS CLARIFICATION: T8.1] sign off on these cells before
		// rendering. The row ships today with `draft: true` so the
		// Comparison component can filter it out until reviewers agree.
		{
			name: "your .cursorrules folder",
			cells: ["✗", "✗", "✗", "✗", "Free"],
			draft: true as const,
		},
	],
} as const;

/** Final CTA. */
export const FINAL_CTA = {
	header: "Run it on your repo. Decide in 60 seconds.",
	body: "No signup. No account. No telemetry unless you turn it on. Works on macOS, Linux, Windows (WSL). Free and open source, Apache 2.0. If it doesn't earn its place in your workflow in one minute, uninstall it and we'll have failed on our own terms.",
	installCommand: INSTALL_COMMAND,
	// NEEDS CLARIFICATION (plan.md open Q1): Discord link — real or cut?
	// Until resolved the Discord entry is omitted.
	secondaryLinks: [
		{ label: "Read the docs", href: "/quickstart" },
		{ label: "Star on GitHub", href: "https://github.com/mainahq/maina" },
		{
			label: "Open an issue",
			href: "https://github.com/mainahq/maina/issues/new",
		},
	],
} as const;

/** FAQ — five `<details>` items. */
export const FAQ = {
	items: [
		{
			q: "Does this phone home?",
			a: "No. Telemetry is opt-in and off by default. You can grep the source.",
		},
		{
			q: "Does this work without Claude/OpenAI keys?",
			a: "Yes, for everything except the AI-fix and AI-review steps of Verify. Everything else is deterministic.",
		},
		{
			q: "Will it slow my commits down?",
			a: "Syntax guard is <500ms. Full verify is ~12s on a typical diff. `maina commit --async` defers the report.",
		},
		{
			q: "How is this different from CodeRabbit?",
			a: "Diff-only, runs locally, rebuilds context for your agent upstream. CodeRabbit reviews after the fact. Maina fixes the input before the fact, then reviews after.",
		},
		{
			q: "Is the context engine just RAG?",
			a: "No. RAG retrieves by vector similarity. Maina uses tree-sitter AST + PageRank over the dependency graph + PR memory with Ebbinghaus decay + Zoekt code search. Similarity is one signal of four.",
		},
	],
} as const;

/** Footer text. */
export const FOOTER = {
	tagline: "Verification-first developer OS.",
	links: [
		{ label: "Cloud", href: "/cloud" },
		{ label: "Docs", href: "/quickstart" },
		{ label: "GitHub", href: "https://github.com/mainahq/maina" },
		{
			label: "License",
			href: "https://github.com/mainahq/maina/blob/master/LICENSE",
		},
	],
} as const;
