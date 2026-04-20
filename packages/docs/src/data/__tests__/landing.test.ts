/**
 * Landing-data invariants.
 *
 * Static tests over `landing.ts` and `terminal-script.ts`. These catch
 * the "copy drift" class of bugs: a locked-spec string deleted by
 * accident, a terminal frame out of time order, an install constant
 * that stops being the single source of truth.
 *
 * For rendered-HTML assertions (every locked phrase appears on /) see
 * the build step in CI — this file is the fast bun:test tier.
 */

import { describe, expect, it } from "bun:test";
import {
	COMPARISON,
	ENGINES,
	FAQ,
	FINAL_CTA,
	FOOTER,
	HERO,
	INSTALL_COMMAND,
	INSTALL_PROMPT,
	META,
	NAV,
	PAIN_STRIP,
	PROOF_STRIP,
	STACK_FIT,
	TERMINAL_SECTION,
} from "../landing";
import { fullFrames, heroFrames } from "../terminal-script";

describe("landing copy invariants", () => {
	it("every install-line reads the shared INSTALL_COMMAND constant", () => {
		expect(HERO.installCommand).toBe(INSTALL_COMMAND);
		expect(TERMINAL_SECTION.installCommand).toBe(INSTALL_COMMAND);
		expect(FINAL_CTA.installCommand).toBe(INSTALL_COMMAND);
	});

	it("INSTALL_PROMPT wraps INSTALL_COMMAND with the shell prompt", () => {
		expect(INSTALL_PROMPT).toBe(`$ ${INSTALL_COMMAND}`);
	});

	it("terminal frames use INSTALL_PROMPT (not a hardcoded string)", () => {
		// Any `input` frame that runs the install command must reach it via
		// the shared constant — no literal "bunx @mainahq/cli@latest setup"
		// baked into terminal-script.ts frames.
		const literal = "bunx @mainahq/cli@latest setup";
		const allFrames = [...heroFrames, ...fullFrames];
		for (const f of allFrames) {
			if (f.kind === "input" && f.text.includes(literal)) {
				expect(f.text).toBe(INSTALL_PROMPT);
			}
		}
	});

	it("meta title matches the verbatim spec headline (anchors the whole page tone)", () => {
		expect(META.title).toStartWith("Maina — ");
		expect(META.title).toContain("wrong context");
	});

	it("hero retains the eyebrow/headline/sub from spec §2", () => {
		expect(HERO.eyebrow.startsWith("// ")).toBe(true);
		expect(HERO.headlineLine1).toBe("Your AI is guessing.");
		expect(HERO.headlineLine2).toContain("the context it was missing");
		expect(HERO.sub).toContain("4-layer context engine");
		expect(HERO.affordances.length).toBe(3);
	});

	it("pain strip has exactly three cards and the cap line", () => {
		expect(PAIN_STRIP.cards.length).toBe(3);
		expect(PAIN_STRIP.cap).toContain("stop");
	});

	it("engines has three cards with at least one proof link each", () => {
		expect(ENGINES.cards.length).toBe(3);
		for (const c of ENGINES.cards) {
			expect(c.proofLinks.length).toBeGreaterThanOrEqual(1);
		}
	});

	it("proof strip has the five canonical receipts", () => {
		expect(PROOF_STRIP.stats.length).toBe(5);
		const values = PROOF_STRIP.stats.map((s) => s.value);
		expect(values).toContain("250+");
		expect(values).toContain("1,167+");
		expect(values).toContain("19");
		expect(values).toContain("41%");
		expect(values).toContain("0");
	});

	it("stack fit lists eleven alphabetised tools plus the any-MCP-client plus-tile", () => {
		expect(STACK_FIT.tools.length).toBe(11);
		const names = STACK_FIT.tools.map((t) => t.name);
		const sorted = [...names].sort();
		expect(names).toEqual(sorted);
	});

	it("comparison has five columns and every row supplies a cell for each", () => {
		expect(COMPARISON.columns.length).toBe(5);
		for (const row of COMPARISON.rows) {
			expect(row.cells.length).toBe(COMPARISON.columns.length);
		}
	});

	it("faq ships the five canonical questions", () => {
		expect(FAQ.items.length).toBe(5);
		expect(FAQ.items.some((i) => i.q.includes("phone home"))).toBe(true);
	});

	it("nav carries Docs, Commands, Wiki, Cloud, GitHub (in order)", () => {
		const labels = NAV.links.map((l) => l.label);
		expect(labels).toEqual(["Docs", "Commands", "Wiki", "Cloud", "GitHub"]);
	});

	it("footer is trimmed — four or fewer links", () => {
		expect(FOOTER.links.length).toBeLessThanOrEqual(4);
	});

	it("final cta omits Discord until the sign-off lands", () => {
		const hasDiscord = FINAL_CTA.secondaryLinks.some((l) =>
			l.href.includes("discord"),
		);
		expect(hasDiscord).toBe(false);
	});
});

describe("terminal script invariants", () => {
	it("hero frames are monotonic in time (non-decreasing)", () => {
		for (let i = 1; i < heroFrames.length; i++) {
			const prev = heroFrames[i - 1];
			const curr = heroFrames[i];
			if (!prev || !curr) continue;
			expect(curr.t).toBeGreaterThanOrEqual(prev.t);
		}
	});

	it("full frames are monotonic in time and every frame has a chapter marker", () => {
		for (let i = 1; i < fullFrames.length; i++) {
			const prev = fullFrames[i - 1];
			const curr = fullFrames[i];
			if (!prev || !curr) continue;
			expect(curr.t).toBeGreaterThanOrEqual(prev.t);
		}
		// Membership check — a typo like "verfiy" in one frame's chapter
		// would previously have passed `toBeDefined`.
		const validChapters = new Set(TERMINAL_SECTION.chapters.map((c) => c.id));
		for (const f of fullFrames) {
			expect(f.chapter).toBeDefined();
			expect(validChapters.has(f.chapter as string)).toBe(true);
		}
	});

	it("hero script stays under 55 seconds so the 3-second loop pause fits", () => {
		const last = heroFrames[heroFrames.length - 1]?.t ?? 0;
		expect(last).toBeLessThan(55);
	});

	it("full-width script covers every chapter declared in TERMINAL_SECTION", () => {
		const chapters = new Set(fullFrames.map((f) => f.chapter));
		for (const c of TERMINAL_SECTION.chapters) {
			expect(chapters.has(c.id)).toBe(true);
		}
	});
});
