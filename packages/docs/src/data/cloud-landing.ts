/**
 * Cloud-landing copy — single source of truth for `/cloud`.
 *
 * Every string on the cloud page originates here. `spec.md §Final copy
 * (locked)` is the contract: engineers do not retype these lines in
 * markup.
 *
 * Re-uses `INSTALL_COMMAND` from `./landing` for the OSS cross-pitch
 * card in the final CTA.
 */

import { INSTALL_COMMAND } from "./landing";

export { INSTALL_COMMAND };

/** Meta / SEO — distinct from the `/` page's META. */
export const CLOUD_META = {
	title:
		"Maina Cloud — one constitution for your team's AI coders. Every diff, proved.",
	description:
		"Your team is shipping AI-written code with 47 different sets of rules and no audit trail. Maina Cloud gives you one versioned constitution, a permalinkable proof for every verification run, and team-level prompt evolution. Built on top of the open-source Maina CLI.",
	ogTitle: "47 `.cursorrules` files. Zero receipts.",
	ogDescription:
		"That's how most teams govern AI coding today. Maina Cloud fixes both — one constitution, every diff verified, every proof linkable.",
	// Set once scripts/generate-og.ts produces the image. Until then
	// the og:image meta tag is skipped.
	ogImage: null as string | null,
	url: "https://mainahq.com/cloud",
} as const;

/** Cloud hero. */
export const CLOUD_HERO = {
	eyebrow:
		"// maina cloud · private beta · no credit card, no sales call until you ask for one",
	headlineLine1: "47 .cursorrules files.",
	headlineLine2: "Zero receipts.",
	sub: "That's how most teams govern AI coding today. One rule file per dev, drifting every week. No audit trail of what the AI changed, or why it was approved. Maina Cloud is the coordination layer: one versioned constitution synced to every machine, a permalinkable proof for every diff your team's AI touches, and team-level prompt evolution that actually learns. Built on top of the open-source Maina CLI your devs already run.",
	primaryCta: { label: "Join the private beta", target: "#waitlist" },
	secondaryCta: { label: "Book a 20-minute demo", target: "#demo" },
	tertiaryLink: {
		label: "Already running Maina OSS? See what Cloud adds ↓",
		target: "#oss-vs-cloud",
	},
	/** Annotation band under the hero terminal (spec §4). */
	chapters: [
		{
			id: "login",
			number: "01",
			label: "login",
			tooltip:
				"GitHub device flow, no API key, auth lives in ~/.maina/auth.json",
		},
		{
			id: "sync",
			number: "02",
			label: "sync",
			tooltip:
				"team constitution + prompts arrive on every machine, hashed and versioned",
		},
		{
			id: "verify",
			number: "03",
			label: "verify",
			tooltip: "the same 19-tool pipeline from OSS runs on the diff",
		},
		{
			id: "proof",
			number: "04",
			label: "proof",
			tooltip:
				"the run gets a permalinkable URL you can paste into the PR, into Slack, into the audit binder",
		},
	],
} as const;

/** Governance pain strip — three org-voice recognition cards. */
export const GOVERNANCE_PAIN_STRIP = {
	cards: [
		{
			label: "// every Monday",
			body: "Your senior eng resolves the same AI-coding policy debate in Slack for the fourth week running, because the rules live in 47 different .cursorrules files.",
		},
		{
			label: "// post-mortem, page 3",
			body: '"Why did the AI merge that?" — no one can answer, because there\'s no record of the prompt, the context, or the review.',
		},
		{
			label: "// SOC 2 audit, week of",
			body: '"Show me the evidence your AI-generated changes were reviewed." You have commit messages and a shrug.',
		},
	],
	cap: "Maina Cloud is the layer that makes all three answerable.",
} as const;

/** Cloud feature grid — six hard-truth cards. */
export const CLOUD_FEATURE_GRID = {
	header: "What Cloud adds on top of the OSS.",
	cards: [
		{
			id: "constitution",
			title: "One constitution, hashed and versioned.",
			body: 'Your team\'s AI-coding rules live in one file, in one repo, with a git history. Maina syncs it to every machine on every pull. No more .cursorrules drift. No more "which version did you approve?"',
			proof: "Proof: ADR-0012 · team prompt sync.",
			proofLinks: [{ label: "ADR-0012", href: "/adr/0012" }],
		},
		{
			id: "proof",
			title: "Permalinkable proof for every diff.",
			body: "Every verification run your team executes — local, CI, or ad-hoc — is stored with its context, its findings, and its result. Paste the URL into the PR description. Paste it into Slack. Paste it into the audit binder.",
			proof: "Proof: ADR-0013 · Cloudflare R2-backed report storage.",
			proofLinks: [{ label: "ADR-0013", href: "/adr/0013" }],
		},
		{
			id: "auth",
			title: "GitHub OAuth device flow. No API keys.",
			body: "`maina login` opens a browser, your dev approves it with their GitHub account, and a scoped token lands in `~/.maina/auth.json`. No API keys copy-pasted into terminals. No shared secrets in CI.",
			proof: "Proof: ADR-0012 · auth flow section.",
			proofLinks: [{ label: "ADR-0012", href: "/adr/0012#auth-flow" }],
		},
		{
			id: "team-rl",
			title: "Team-level prompt evolution.",
			body: "Every accept/reject your team makes feeds a shared RL loop. Prompts improve at team speed, not individual speed. A/B candidates are proposed, reviewed, promoted. You see the diff before anything changes.",
			proof: "Proof: ADR-0005, ADR-0006.",
			proofLinks: [
				{ label: "ADR-0005", href: "/adr/0005" },
				{ label: "ADR-0006", href: "/adr/0006" },
			],
		},
		{
			id: "telemetry",
			title: "Opt-out telemetry. EU hosting.",
			body: "Telemetry is on by default for support triage, off with one env var. Errors are stack-trace-scrubbed of your code. Data sits in PostHog EU. Your CISO gets a one-page vendor profile.",
			proof: "Proof: ADR-0016.",
			proofLinks: [{ label: "ADR-0016", href: "/adr/0016" }],
		},
		{
			id: "privacy",
			title: "Your code stays on your machines.",
			body: "Maina Cloud stores verification reports, team prompts, and metadata. It does not store your source code. The CLI runs locally. The AI calls your own keys. We see outcomes, not implementations.",
			proof: "Proof: threat model in the private beta docs.",
			proofLinks: [{ label: "threat model", href: "/cloud/threat-model" }],
		},
	],
} as const;

/** OSS ↔ Cloud comparison matrix. */
export const OSS_VS_CLOUD = {
	header: "The OSS CLI is free forever. Cloud is what a team needs on top.",
	columns: [
		{ id: "oss", label: "Maina OSS (free)" },
		{ id: "cloud", label: "Maina Cloud" },
	],
	rows: [
		{ capability: "Context engine", oss: "✅", cloud: "✅" },
		{ capability: "19-tool verify pipeline", oss: "✅", cloud: "✅" },
		{ capability: "Local cache", oss: "✅", cloud: "✅" },
		{
			capability: "Prompt versioning",
			oss: "Local only",
			cloud: "Team-synced, hashed, history",
		},
		{
			capability: "Constitution",
			oss: "One file on your machine",
			cloud: "One file, synced to every machine",
		},
		{
			capability: "Verification reports",
			oss: "Local stdout + file",
			cloud: "Permalinkable URL per run",
		},
		{
			capability: "Auth",
			oss: "None needed",
			cloud: "GitHub OAuth device flow",
		},
		{
			capability: "Prompt A/B testing",
			oss: "Disabled",
			cloud: "Enabled at team level",
		},
		{
			capability: "Run history / audit",
			oss: "None",
			cloud: "Queryable, retainable per policy",
		},
		{
			capability: "Support",
			oss: "GitHub issues",
			cloud: "Private beta Slack, then email",
		},
		{
			capability: "Cost",
			oss: "$0 forever",
			// [NEEDS CLARIFICATION: pricing row] — spec open Q. Placeholder
			// copy; reviewer sign-off required before shipping.
			cloud: "Pricing by team size, shared on the demo call",
		},
	],
	cap: "If you're a solo dev, stop here and run the OSS. If you're a team, the coordination and receipts are the point.",
} as const;

/** Waitlist form. */
export const WAITLIST = {
	header: "Join the private beta.",
	body: "We're onboarding ~15 teams to the first cohort. We'll get back within 48 hours. No credit card, no demo required, no sales call until you ask for one.",
	fields: {
		email: {
			label: "Work email",
			name: "email",
			required: true,
			placeholder: "you@company.com",
		},
		role: {
			label: "Your role",
			name: "role",
			required: true,
			options: [
				{ value: "eng_lead", label: "Eng lead" },
				{ value: "ic_dev", label: "IC dev" },
				{ value: "cto", label: "CTO" },
				{ value: "vp_eng", label: "VP Eng" },
				{ value: "founder", label: "Founder" },
				{ value: "other", label: "Other" },
			],
		},
		teamSize: {
			label: "Team size",
			name: "team_size",
			required: true,
			options: [
				{ value: "1-5", label: "1–5" },
				{ value: "6-20", label: "6–20" },
				{ value: "21-50", label: "21–50" },
				{ value: "51-200", label: "51–200" },
				{ value: "200+", label: "200+" },
			],
		},
		company: {
			label: "Company",
			name: "company",
			required: false,
			placeholder: "Acme Corp",
		},
		notes: {
			label: "Anything else we should know?",
			name: "notes",
			required: false,
			rows: 2,
		},
	},
	submitLabel: "Request access",
	privacy:
		"We use your email only for beta coordination. We don't sell, share, or market-enrich it. You can delete your record with one email to beta@mainahq.com.",
	// Resolved path TBD — mailto fallback works today.
	// [NEEDS CLARIFICATION: waitlist backend] — Worker vs PostHog vs Formspree.
	mailto: "beta@mainahq.com",
	thankyou: "Request received. Check your inbox within 48 hours.",
} as const;

/** Demo booking card. */
export const DEMO = {
	header: "Would rather see it run first?",
	body: "20 minutes, your repo on screen, no slides. We'll install Maina on a clone of your monorepo, run the 19-tool verify on a real diff, and show you what a permalinkable proof looks like. If it's not worth the 20 minutes, we'll owe you coffee.",
	ctaLabel: "Pick a time →",
	// [NEEDS CLARIFICATION: scheduler] — Cal.com / Calendly / mailto.
	// Mailto for today; swap when scheduler decision lands.
	mailto: "demo@mainahq.com",
} as const;

/** Receipts strip — cloud-specific stats. */
export const CLOUD_PROOF_STRIP = {
	stats: [
		{
			value: "250+",
			label: "commits, every one self-verified by `maina commit`",
			href: "https://github.com/mainahq/maina/commits/master",
		},
		{
			value: "19",
			label: "tools in the verify pipeline",
			href: "/adr/0002",
		},
		{
			value: "~48h",
			label: "median reply on beta requests",
			href: "#waitlist",
		},
		{
			value: "0",
			label: "lines of your source code stored by Cloud",
			href: "/cloud/threat-model",
		},
		{
			value: "EU",
			label: "telemetry hosting option",
			href: "/adr/0016",
		},
	],
} as const;

/** Cloud FAQ — seven items. */
export const CLOUD_FAQ = {
	items: [
		{
			q: "Does Maina Cloud store my source code?",
			a: "No. It stores verification reports, team prompts, and run metadata. The CLI runs locally. The AI calls your own keys.",
		},
		{
			q: "Do you train on my data?",
			a: "No. We don't have models to train. The AI steps in Verify use your keys against your chosen provider. We see the outcomes of those calls, not the inputs.",
		},
		{
			q: "Can we self-host?",
			a: "Not in the private beta. On the roadmap for teams 100+ devs.",
		},
		{
			q: "What's the pricing?",
			a: "Pricing scales with team size. We share it on the demo call, because the right tier depends on how you'll use it. No surprises, no per-seat traps.",
		},
		{
			q: "What happens if we cancel?",
			a: "Your team's constitution and prompts are already in your repo. Export run history with one command. We delete everything within 30 days on request.",
		},
		{
			q: "How is this different from CodeRabbit / Greptile for teams?",
			a: "They review after the fact. Maina fixes the context the AI sees before the fact, runs the review locally so findings are diff-only and under your keys, and stores the proof so you have an audit trail. Different layer of the stack.",
		},
		{
			q: "Does the OSS keep working?",
			a: "Forever. Apache 2.0. Cloud is additive, not a replacement.",
		},
	],
} as const;

/** Final CTA — two cards side by side. */
export const CLOUD_FINAL_CTA = {
	header: "Two links. Your call.",
	waitlistCard: {
		title: "Join the private beta",
		body: "15 teams, 48-hour replies, no sales call until you ask.",
		ctaLabel: "Request access",
		target: "#waitlist",
	},
	ossCard: {
		title: "Or try the OSS first, tonight",
		body: "One command. 60 seconds. No signup. Free forever.",
		install: INSTALL_COMMAND,
		docsLabel: "Read the docs →",
		docsTarget: "/",
	},
} as const;
