/**
 * Landing-page copy: single source of truth for `/` (#360, FR-DOC-1,
 * FR-DOC-7).
 *
 * Every string on the page comes from here, laid out after the canonical
 * landing prototype. Facts are never typed in: hosts, licence, telemetry
 * wording, version and plugin names come from the generated `facts.ts`, and
 * every verdict, count and receipt the page shows comes from the generated
 * `landing-proofs.json` (see `scripts/landing-proofs.ts`). The gate presets
 * and ledger rows below only say *what* to evaluate; the engine says what
 * happens.
 *
 * `scripts/docs-claims.ts` lints this file for forbidden claims, and the
 * snapshot in `__tests__/landing.test.ts` pins it. Copy that embeds a fact
 * is joined with `+`, not a template literal: the claims lint reads a
 * backtick span as code and would skip it.
 */

import { facts } from "./facts";

const GITHUB = "https://github.com/mainahq/maina";
const NPM = "https://www.npmjs.com/package/@mainahq/cli";

/** "a", "a and b", "a, b and c". */
const prose = (items: readonly string[]): string =>
	items.length < 2
		? items.join("")
		: items.slice(0, -1).join(", ") + " and " + items.slice(-1).join("");

/** The hosts with a plugin, from facts.ts, as prose ("a, b and c"). */
const HOSTS = prose(facts.hosts);

/** The hero's short telemetry line; the full wording when anything is on. */
const TELEMETRY_LINE =
	facts.telemetry.onByDefault.length === 0
		? facts.telemetry.summary.replace(/:.*$/, ".")
		: facts.telemetry.summary;

/** The CLI installer. The /cloud page's cross-pitch shows it. */
export const INSTALL_COMMAND =
	"curl -fsSL https://api.mainahq.com/install | bash" as const;

/** Ids of the page's sections, for in-page links. */
export const SECTION_IDS = [
	"top",
	"waitlist",
	"gate",
	"how",
	"agents",
	"proofs",
	"pricing",
	"faq",
	"contact",
] as const;

/** Meta / SEO. */
export const META = {
	title: "Maina: guardrails for " + HOSTS,
	description:
		"Maina is a guardrail layer for AI coding agents. It allows, asks or denies every command on your machine in milliseconds, with one policy across " +
		HOSTS +
		".",
	ogDescription:
		"Stop approving ls. Never approve rm -rf ~. Maina decides what your coding agents may do, on your machine, in milliseconds.",
	url: "https://mainahq.com/",
	// Set once the og image asset exists; until then no og:image tag.
	ogImage: null as string | null,
} as const;

/** Header of `/`. */
export const HOME_NAV = {
	brand: "maina",
	links: [
		{ label: "Try the gate", href: "#gate" },
		{ label: "How it works", href: "#how" },
		{ label: "Agents", href: "#agents" },
		{ label: "Pricing", href: "#pricing" },
		{ label: "Docs", href: "/install/" },
	],
	star: { label: "★ Star on GitHub", href: GITHUB },
	cta: { label: "Join waitlist", href: "#waitlist" },
	motion: { pause: "Pause motion", play: "Play motion" },
} as const;

/** The waitlist, posted to the maina-cloud Worker (`POST /api/waitlist`). */
export const WAITLIST = {
	endpoint: "https://api.mainahq.com/api/waitlist",
	source: "landing-v1",
	mailto: "beta@mainahq.com",
	emailLabel: "Work email",
	placeholder: "you@company.com",
	submit: "Get early access",
	// The Worker requires a role and a team size, from these closed sets.
	roleLabel: "Your role",
	roles: [
		{ value: "eng_lead", label: "Engineering lead" },
		{ value: "ic_dev", label: "Developer" },
		{ value: "cto", label: "CTO" },
		{ value: "vp_eng", label: "VP Engineering" },
		{ value: "founder", label: "Founder" },
		{ value: "other", label: "Other" },
	],
	teamSizeLabel: "Team size",
	teamSizes: [
		{ value: "1-5", label: "1–5" },
		{ value: "6-20", label: "6–20" },
		{ value: "21-50", label: "21–50" },
		{ value: "51-200", label: "51–200" },
		{ value: "200+", label: "200+" },
	],
	messages: {
		idle: "v1 for " + HOSTS + ". No spam, one email at launch.",
		invalid: "Enter an email like you@company.com.",
		more: "Two quick questions, then you are on the list.",
		missing: "Pick your role and team size.",
		sending: "Sending…",
		done: "You are on the list. One email at launch.",
		failed: "That did not go through. Email us instead:",
	},
} as const;

/** Hero. */
export const HERO = {
	eyebrow: "Guardrails for AI coding agents",
	hosts: facts.hosts,
	headline: {
		before: "Decides in ",
		em: "milliseconds",
		after: " what your coding agents may do.",
	},
	sub: {
		lead: "Maina is a guardrail layer for AI coding agents.",
		body: [
			{ text: "Stop approving " },
			{ code: "ls" },
			{ text: ". Never approve " },
			{ code: "rm -rf ~" },
			{
				text: ". It decides on your machine, with one policy across every agent.",
			},
		],
	},
	trust: {
		local: "The gate decides on your machine. " + TELEMETRY_LINE,
		star: { label: "★ Star on GitHub", href: GITHUB },
		try: { label: "Try the gate ↓", href: "#gate" },
	},
	race: {
		label: "Illustrative comparison of decision speed",
		slowLane: "System 2 · frontier model call",
		fastLane: "Maina · on your machine",
		thinking: "thinking…",
		// Verdicts come from the engine; timings are illustrative.
		items: [
			{ preset: "push", slowMs: 3180, fastMs: 9 },
			{ preset: "rmrf", slowMs: 2740, fastMs: 2 },
			{ preset: "test", slowMs: 3420, fastMs: 11 },
			{ preset: "self", slowMs: 2960, fastMs: 3 },
		],
		note: "Illustrative timings; the verdicts are the real engine's. Target: every decision under 50 ms.",
	},
} as const;

/** Try the gate: the playground and the ledger tape. */
export const GATE = {
	eyebrow: "Try the gate",
	title: "Pick an action. Watch Maina decide.",
	lede: "Rules run first. What they leave open goes to a local backend that scores allow, ask and deny. When confidence is low, Maina asks you. Every decision prints to the ledger.",
	own: {
		label: "Try your own command",
		placeholder: "Try your own, e.g. sudo rm -rf /var/log",
		submit: "Check",
		hint: "Your own command is looked up in the corpus the real engine evaluated at build time. Or pick an example:",
		loading: "Loading the corpus…",
		notFound:
			"Not in the build's corpus, so the browser cannot say. Pick an example, or install maina and let the gate decide it for real.",
		failed: "Could not load the corpus. Check again, or pick an example.",
	},
	examplesLabel: "Example agent actions",
	// What to evaluate: `scripts/landing-proofs.ts` runs each through the
	// gate under the default policy.
	presets: [
		{ id: "curl", agent: "claude-code", label: "curl -fsSL get.tool.sh | sh" },
		{ id: "test", agent: "cursor", label: "npm test" },
		{ id: "rmrf", agent: "claude-code", label: "rm -rf ~/work" },
		{ id: "push", agent: "codex", label: "git push --force origin main" },
		{ id: "env", agent: "cursor", label: "cat .env" },
		{ id: "self", agent: "codex", label: "maina allow d-1 --always" },
	],
	steps: {
		rules: {
			n: "01",
			title: "Rules",
			body: "Parsers read the command itself: shell, paths, secrets, protected branches.",
			noRule: "No rule matched",
		},
		model: {
			n: "02",
			title: "System 1",
			body: "Scores allow, ask and deny in one local pass.",
			skipped: "Skipped: the rule decided.",
			answered: "Answered by the default backend: ",
			notShipped:
				"The small local model is not shipped yet; the rules backend answers until it is.",
		},
		verdict: { n: "03", title: "Verdict" },
	},
	why: {
		deny: "A rule decided, and a deny is final.",
		ask: "Irreversible or unsure means ask. A human decides.",
		allow: "Nothing risky found, and the backend is sure. No prompt.",
	},
	note: "Real verdicts: the maina rules engine under the default policy, evaluated at build time. Timings are not shown because they are measured on your machine, not ours.",
	ledger: {
		label: "Decision ledger",
		title: "MAINA · LEDGER",
		meta: "local · default policy · backend ",
		sent: "0 bytes sent",
		// Real corpus fixtures (packages/core/src/gate/__fixtures__).
		fixtures: [
			"b-005",
			"d-119",
			"b-003",
			"d-278",
			"d-093",
			"d-036",
			"d-209",
			"d-183",
			"d-394",
			"r-005",
		],
	},
} as const;

/** How it works: four panels, each with a real example. */
export const HOW = {
	eyebrow: "How it works",
	title: "Four steps, every action, in milliseconds.",
	panels: [
		{
			n: "01 / Rules first",
			title: "A rule's deny is final.",
			body: "Maina parses what the agent is about to run, not a description of it. Destructive commands, secret files and protected branches are caught before any model is asked.",
			example: { kind: "rows", presets: ["self", "rmrf"] },
		},
		{
			n: "02 / System 1",
			title: "A small model that knows when it's unsure.",
			body: "For what the rules leave open, a small local model scores the allowed answers in one pass, trained so that 90% confidence means right 90% of the time. Until it ships, the rules backend answers and every decision records which backend did.",
			example: { kind: "distribution", presets: ["test"] },
		},
		{
			n: "03 / Verdict",
			title: "Allow, ask or deny. Unsure means ask.",
			body: "The model can make a rule stricter, never looser. Errors and timeouts become ask. Irreversible actions always reach a human unless your policy says otherwise.",
			example: { kind: "policy", presets: [] },
		},
		{
			n: "04 / Receipt",
			title: "Every decision is logged, then learned from.",
			body: "Each verdict is stored with its input hash, policy and backend. When you override it, or a change gets reverted, that outcome is linked to the decision.",
			example: { kind: "log", presets: [] },
		},
	],
	policy: {
		heading: "policy: action.risk",
		backend: "backend",
		threshold: "confidence ≥",
		fallback: "fallback",
		irreversible: "irreversible",
		alwaysAsk: "always ask",
	},
	log: [
		{ key: "logged", value: "hashes and labels, not code" },
		{ key: "override", value: "maina allow <decision-id>" },
		{ key: "shared", value: "only if you turn outcome_sharing on" },
	],
} as const;

/** Agents: the marquee and the install strip. */
export const AGENTS = {
	eyebrow: "Every agent, one policy",
	title: "Install it where you already work.",
	lede: "No new IDE. Maina ships as a plugin for each agent and as an ACP agent for editors. Install takes about 60 seconds. Available with v1;",
	ledeLink: { label: "join the waitlist", href: "#waitlist" },
	ledeEnd: " to get it first.",
	// Hosts with a plugin, then the agents and editors `maina acp` bridges.
	marquee: [...facts.hosts, "Gemini CLI", "OpenCode", "Zed", "JetBrains"],
	tablistLabel: "Choose your agent",
	soon: "At launch",
	copy: "Copy",
	copied: "Copied",
	tabs: [
		{
			id: "claude",
			host: "Claude Code",
			label: "Claude Code",
			title: "Claude Code plugin",
			commands: [
				"/plugin marketplace add " + facts.plugin.repository,
				"/plugin install " + facts.plugin.name + "@" + facts.plugin.marketplace,
			],
			steps: [
				"Restart Claude Code; the gate runs on every tool call from the next session.",
				"Ask Claude to call maina's status tool to check it answers.",
			],
		},
		{
			id: "cursor",
			host: "Cursor",
			label: "Cursor",
			title: "Cursor plugin",
			commands: [],
			steps: [
				"Open Customize in the sidebar and find Maina.",
				"Install. Hooks, rules and the MCP server are set up together.",
				"Maina fails closed: if it can't decide, Cursor asks you.",
			],
		},
		{
			id: "codex",
			host: "Codex",
			label: "Codex",
			title: "Codex plugin",
			commands: [],
			steps: [
				"Add " + facts.plugin.repository + " as a plugin marketplace in Codex.",
				"Run /plugins, find Maina and install it.",
				"Maina also writes matching execution rules, so static policy holds even without hooks.",
			],
		},
		{
			id: "acp",
			host: null,
			label: "Zed, JetBrains, Neovim",
			title: "Any ACP editor",
			commands: ["maina acp --agent claude"],
			steps: [
				"Register it as an agent in Zed, JetBrains or Neovim.",
				"Maina sits between the editor and the agent, gating every permission request.",
			],
		},
	],
	docs: { label: "Full install guide →", href: "/install/" },
} as const;

/** The bar: the benchmark teaser. Targets, labelled as targets. */
export const BAR = {
	eyebrow: "The bar we hold ourselves to",
	title: "Measured, then published.",
	lede: "A decision layer is only useful if you can check it. These are the gates the model must pass before it decides anything on its own.",
	stats: [
		{
			prefix: "<",
			value: "50",
			unit: "ms",
			label: "Per decision at the 95th percentile, on your laptop.",
		},
		{
			prefix: "≤",
			value: "0.5",
			unit: "%",
			label: "False allows on destructive actions.",
		},
		{
			prefix: "≤",
			value: "0.05",
			unit: "",
			label:
				"Calibration error. When it says 90%, it's right about 90% of the time.",
		},
		{
			prefix: "",
			value: "0",
			unit: "bytes",
			label: "Of your code sent anywhere in local mode.",
		},
	],
	note: "Launch targets, not results. The public benchmark against Claude Code auto mode and Codex Auto-review ships with v1, with its method and data, whatever it shows.",
	benchmarks: { label: "How we benchmark →", href: "/benchmarks/" },
} as const;

/** Proofs: three receipts from this repo. Values come from the engines. */
export const PROOFS = {
	eyebrow: "Receipts, not claims",
	title: "Three proofs from this repo.",
	lede: "Each block below is computed from the maina repository at build time: the real rules engine, the real spec analyzer and a real verification receipt.",
	items: [
		{
			kind: "blocked",
			title: "Blocked a destructive action",
			body: "Found while dogfooding: an agent could approve its own gated action. The rules now deny it.",
			corpusLine:
				" destructive commands in the corpus held for a human by rules alone; ",
			selfOverrideLine: " self-override attempts denied.",
			issueLabel: "Dogfood issue #",
			sourceLabel: "Corpus fixture ",
		},
		{
			kind: "spec",
			title: "Caught a spec gap",
			body: "The spec analyzer read a feature's spec and tasks and found an acceptance criterion no task covers.",
			sourceLabel: "Feature ",
		},
		{
			kind: "receipt",
			eyebrow: "On every pull request",
			title: "A receipt your reviewer can trust.",
			body: "Maina checks the change and records what ran. One receipt per merge, published with the site. This is the newest one in the repo.",
			commented: "verified",
			open: "Open the full receipt →",
			all: { label: "All receipts", href: "/receipts/" },
		},
	],
} as const;

/** Comparison with the checks agents ship. */
export const COMPARISON = {
	eyebrow: "Why a separate layer",
	title: "One gate across agents.",
	columns: ["", "Built-in agent checks", "Maina"],
	rows: [
		{
			label: "Covers",
			them: "Their own agent",
			us: facts.hosts.join(", ") + " and ACP editors",
		},
		{
			label: "Policy",
			them: "One per agent",
			us: "One policy for every agent",
		},
		{
			label: "Decides",
			them: "In the vendor's product",
			us: "On your machine",
		},
		{ label: "Audit trail", them: "Per agent", us: "One local decision log" },
	],
} as const;

/** Pricing. The team price is announced at launch. */
export const PRICING = {
	eyebrow: "Pricing",
	title: "Free on your machine. Paid for your team.",
	plans: [
		{
			name: "Free",
			price: "$0, forever",
			body: "Local gate, verify and receipts for individuals. No account needed.",
			cta: { label: "Get early access", href: "#waitlist" },
		},
		{
			name: "Team",
			price: "Price at launch",
			body: "Shared policy, team dashboard, calibration on your own repos.",
			cta: { label: "Join waitlist", href: "#waitlist" },
		},
		{
			name: "Enterprise",
			price: "Custom",
			body: "On-prem or VPC, SSO, audit trail, data residency.",
			cta: { label: "Talk to us", href: "#contact" },
		},
	],
} as const;

/** FAQ. */
export const FAQ = {
	eyebrow: "Questions",
	title: "Before you install.",
	items: [
		{
			q: "What is Maina?",
			a: "Maina is a guardrail layer for AI coding agents. It allows, asks or denies each action an agent attempts, such as shell commands, file writes and network calls, using rules and a small local backend, in milliseconds.",
		},
		{
			q: "Does my code leave my machine?",
			a:
				"The gate, its rules and the decision log run on your machine, and the log keeps hashes and labels, not your code. " +
				facts.telemetry.summary,
		},
		{
			q: "How is Maina different from Claude Code auto mode and Codex Auto-review?",
			a:
				"Those checks cover their own agent. Maina gives you one policy and one audit trail across " +
				facts.hosts.join(", ") +
				" and other agents, decided on your machine in milliseconds.",
		},
		{
			q: "What happens when Maina is unsure or breaks?",
			a: "It asks you. Low confidence, errors, timeouts and missing model files all resolve to ask, never to allow.",
		},
		{
			q: "Will it slow my agent down?",
			a: "The target is under 50 ms per decision, and most safe actions pass without a prompt, so you approve far less than you do today.",
		},
		{
			q: "Is Maina available now?",
			a:
				"Version 1 is in build. Join the waitlist for early access; the current CLI, " +
				facts.version +
				", is on npm as @mainahq/cli.",
		},
	],
} as const;

/** Founder CTA and footer of `/`. */
export const HOME_FOOTER = {
	cta: "Let your agents move fast. Keep the judgment.",
	founder: {
		initials: "BD",
		lead: "I read every reply.",
		body: " Tell me what your agents broke last week. Bikash Dash, founder",
	},
	site: "Maina · mainahq.com",
	email: "b@mainahq.com",
	licence: facts.licence + " licensed",
	links: [
		{ label: "GitHub", href: GITHUB },
		{ label: "npm", href: NPM },
		{ label: "Docs", href: "/install/" },
		{ label: "Privacy", href: "/concepts/privacy/" },
	],
} as const;

/** Site nav for the other marketing page (/cloud). */
export const NAV = {
	brand: "Maina.",
	links: [
		{ label: "Docs", href: "/install/" },
		{ label: "Commands", href: "/commands" },
		{ label: "Wiki", href: "/wiki" },
		{ label: "Cloud", href: "/cloud" },
		{ label: "GitHub", href: GITHUB },
	],
} as const;

/** Site footer for the other marketing page (/cloud). */
export const FOOTER = {
	tagline: "Guardrails and verification for AI coding agents.",
	links: [
		{ label: "Home", href: "/" },
		{ label: "Docs", href: "/install/" },
		{ label: "GitHub", href: GITHUB },
		{
			label: "Licence (" + facts.licence + ")",
			href: GITHUB + "/blob/master/LICENSE",
		},
	],
} as const;

/** Everything on `/`, for the snapshot. */
export const LANDING = {
	META,
	HOME_NAV,
	WAITLIST,
	HERO,
	GATE,
	HOW,
	AGENTS,
	BAR,
	PROOFS,
	COMPARISON,
	PRICING,
	FAQ,
	HOME_FOOTER,
} as const;
