/**
 * Cloud-landing data invariants. Mirrors the `/` suite — catches the
 * same copy-drift / script-drift class of bugs for `/cloud`.
 */

import { describe, expect, it } from "bun:test";
import {
	CLOUD_FAQ,
	CLOUD_FEATURE_GRID,
	CLOUD_FINAL_CTA,
	CLOUD_HERO,
	CLOUD_META,
	CLOUD_PROOF_STRIP,
	DEMO,
	GOVERNANCE_PAIN_STRIP,
	INSTALL_COMMAND,
	OSS_VS_CLOUD,
	WAITLIST,
} from "../cloud-landing";
import { cloudHeroFrames } from "../cloud-terminal-script";

describe("cloud copy invariants", () => {
	it("final CTA OSS card uses the shared INSTALL_COMMAND constant", () => {
		expect(CLOUD_FINAL_CTA.ossCard.install).toBe(INSTALL_COMMAND);
	});

	it("meta has the governance-led OG title + long description", () => {
		expect(CLOUD_META.title).toContain("Maina Cloud");
		expect(CLOUD_META.ogTitle).toContain(".cursorrules");
		expect(CLOUD_META.ogTitle).toContain("Zero receipts");
	});

	it("hero keeps the locked governance headline split into two lines", () => {
		expect(CLOUD_HERO.headlineLine1).toBe("47 .cursorrules files.");
		expect(CLOUD_HERO.headlineLine2).toBe("Zero receipts.");
		expect(CLOUD_HERO.primaryCta.label).toBe("Join the private beta");
		expect(CLOUD_HERO.secondaryCta.label).toBe("Book a 20-minute demo");
	});

	it("hero chapters declare login, sync, verify, proof in order", () => {
		const ids = CLOUD_HERO.chapters.map((c) => c.id);
		expect(ids).toEqual(["login", "sync", "verify", "proof"]);
	});

	it("governance pain strip has three cards + cap line", () => {
		expect(GOVERNANCE_PAIN_STRIP.cards.length).toBe(3);
		expect(GOVERNANCE_PAIN_STRIP.cap).toContain("answerable");
	});

	it("feature grid ships six cards with at least one proof link each", () => {
		expect(CLOUD_FEATURE_GRID.cards.length).toBe(6);
		for (const c of CLOUD_FEATURE_GRID.cards) {
			expect(c.proofLinks.length).toBeGreaterThanOrEqual(1);
		}
	});

	it("OSS vs Cloud matrix has two columns and every row supplies oss + cloud", () => {
		expect(OSS_VS_CLOUD.columns.length).toBe(2);
		for (const row of OSS_VS_CLOUD.rows) {
			expect(typeof row.oss).toBe("string");
			expect(typeof row.cloud).toBe("string");
		}
	});

	it("waitlist has all five field definitions", () => {
		expect(WAITLIST.fields.email.required).toBe(true);
		expect(WAITLIST.fields.role.required).toBe(true);
		expect(WAITLIST.fields.teamSize.required).toBe(true);
		expect(WAITLIST.fields.company.required).toBe(false);
		expect(WAITLIST.fields.notes.required).toBe(false);
	});

	it("demo booking falls back to mailto when no scheduler is wired", () => {
		expect(DEMO.mailto).toContain("@mainahq.com");
	});

	it("proof strip has the five cloud-specific stats", () => {
		expect(CLOUD_PROOF_STRIP.stats.length).toBe(5);
		const values = CLOUD_PROOF_STRIP.stats.map((s) => s.value);
		expect(values).toContain("0");
		expect(values).toContain("EU");
	});

	it("cloud FAQ ships seven items", () => {
		expect(CLOUD_FAQ.items.length).toBe(7);
	});
});

describe("cloud terminal script invariants", () => {
	it("frames are monotonic in time", () => {
		for (let i = 1; i < cloudHeroFrames.length; i++) {
			const prev = cloudHeroFrames[i - 1];
			const curr = cloudHeroFrames[i];
			if (!prev || !curr) continue;
			expect(curr.t).toBeGreaterThanOrEqual(prev.t);
		}
	});

	it("script covers every declared chapter id", () => {
		const seen = new Set(cloudHeroFrames.map((f) => f.chapter).filter(Boolean));
		for (const c of CLOUD_HERO.chapters) {
			expect(seen.has(c.id)).toBe(true);
		}
	});

	it("script stays under 45 seconds so the band still feels tight", () => {
		const last = cloudHeroFrames[cloudHeroFrames.length - 1]?.t ?? 0;
		expect(last).toBeLessThan(45);
	});
});
