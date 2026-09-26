/**
 * Landing-data invariants (#360, FR-DOC-1, FR-DOC-7).
 *
 * `landing.ts` holds every string on `/`. The snapshot pins the copy so a
 * change to it is a reviewed change; the other tests pin where the facts in
 * it come from: hosts, licence, telemetry wording and install commands from
 * the generated `facts.ts`, verdicts and proofs from the generated
 * `landing-proofs.json` (the real rules engine, the real spec analyzer and
 * the real receipts of this repo).
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { facts } from "../facts";
import {
	AGENTS,
	FAQ,
	FOOTER,
	GATE,
	HERO,
	HOME_FOOTER,
	HOME_NAV,
	INSTALL_COMMAND,
	LANDING,
	META,
	PROOFS,
	SECTION_IDS,
	WAITLIST,
} from "../landing";
import type { LandingProofs } from "../landing-proofs";
import proofsJson from "../landing-proofs.json";

const proofs = proofsJson as unknown as LandingProofs;
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

describe("landing copy", () => {
	it("matches the reviewed snapshot", () => {
		expect(LANDING).toMatchSnapshot();
	});

	it("leads with the canonical headline", () => {
		const { before, em, after } = HERO.headline;
		expect(`${before}${em}${after}`).toBe(
			"Decides in milliseconds what your coding agents may do.",
		);
		expect(META.title).toBe(
			"Maina: guardrails for Claude Code, Codex and Cursor",
		);
	});

	it("names the hosts facts.ts names, in its order", () => {
		expect(HERO.hosts).toEqual(facts.hosts);
	});

	it("takes the licence and the telemetry wording from facts.ts", () => {
		expect(HOME_FOOTER.licence).toContain(facts.licence);
		const privacy = FAQ.items.find((i) => i.q.includes("leave my machine"));
		expect(privacy?.a).toContain(facts.telemetry.summary);
	});

	// The header's promise, "facts are never typed in": the host list and
	// the telemetry claim are joined from facts.ts, so adding a host or
	// turning a channel on changes every line that states them.
	it("never types the host list or the telemetry default in by hand", () => {
		const typedIn = readFileSync(
			join(import.meta.dir, "..", "landing.ts"),
			"utf8",
		)
			.split("\n")
			.filter((line) => /Claude Code, Codex|off by default/i.test(line));
		expect(typedIn).toEqual([]);
		const hosts = facts.hosts.slice(0, 2).join(", ");
		expect(META.title).toContain(hosts);
		expect(WAITLIST.messages.idle).toContain(hosts);
		expect(HERO.trust.local).toContain(
			facts.telemetry.onByDefault.length === 0
				? "Telemetry is off by default."
				: facts.telemetry.summary,
		);
	});

	it("keeps the CLI install command for the /cloud cross-pitch", () => {
		expect(INSTALL_COMMAND).toBe(
			"curl -fsSL https://api.mainahq.com/install | bash",
		);
		expect(FOOTER.links.length).toBeGreaterThan(0);
	});
});

describe("install strip", () => {
	it("builds the Claude Code commands from the generated plugin names", () => {
		const claude = AGENTS.tabs.find((t) => t.id === "claude");
		expect(claude?.commands).toEqual([
			`/plugin marketplace add ${facts.plugin.repository}`,
			`/plugin install ${facts.plugin.name}@${facts.plugin.marketplace}`,
		]);
	});

	it("has one tab per host plus the ACP editors, each with steps", () => {
		const ids = AGENTS.tabs.map((t) => t.id);
		expect(ids).toEqual(["claude", "cursor", "codex", "acp"]);
		expect(AGENTS.tabs.slice(0, 3).map((t) => t.host)).toEqual([
			...facts.hosts.filter((h) => h === "Claude Code"),
			...facts.hosts.filter((h) => h === "Cursor"),
			...facts.hosts.filter((h) => h === "Codex"),
		]);
		for (const tab of AGENTS.tabs) {
			expect(tab.steps.length).toBeGreaterThan(0);
		}
	});

	it("uses only maina commands that exist", () => {
		const acp = AGENTS.tabs.find((t) => t.id === "acp");
		for (const cmd of acp?.commands ?? []) {
			const sub = cmd.split(" ")[1] ?? "";
			expect(facts.commands.names as readonly string[]).toContain(sub);
		}
	});
});

describe("waitlist", () => {
	it("posts to the maina-cloud Worker with its closed role and team-size sets", () => {
		expect(WAITLIST.endpoint).toBe("https://api.mainahq.com/api/waitlist");
		expect(WAITLIST.roles.map((r) => r.value)).toEqual([
			"eng_lead",
			"ic_dev",
			"cto",
			"vp_eng",
			"founder",
			"other",
		]);
		expect(WAITLIST.teamSizes.map((t) => t.value)).toEqual([
			"1-5",
			"6-20",
			"21-50",
			"51-200",
			"200+",
		]);
		expect(WAITLIST.source).toBe("landing-v1");
	});
});

describe("try the gate", () => {
	it("has a real engine result for every preset", () => {
		for (const preset of GATE.presets) {
			const row = proofs.gate.presets[preset.id];
			expect(row, preset.id).toBeDefined();
			expect(row?.label).toBe(preset.label);
		}
	});

	it("shows allow, ask and deny among the presets", () => {
		const verdicts = new Set(
			GATE.presets.map((p) => proofs.gate.presets[p.id]?.verdict),
		);
		expect([...verdicts].sort()).toEqual(["allow", "ask", "deny"]);
	});

	it("prints real corpus rows on the ledger", () => {
		expect(proofs.gate.ledger.length).toBe(GATE.ledger.fixtures.length);
		expect(proofs.gate.ledger.map((r) => r.id)).toEqual([
			...GATE.ledger.fixtures,
		]);
	});
});

describe("proofs", () => {
	it("are three, each backed by a real receipt from this repo", () => {
		expect(PROOFS.items.map((p) => p.kind)).toEqual([
			"blocked",
			"spec",
			"receipt",
		]);
		expect(proofs.proofs.blocked.verdict).toBe("deny");
		expect(existsSync(join(REPO_ROOT, proofs.proofs.blocked.source))).toBe(
			true,
		);
		expect(existsSync(join(REPO_ROOT, proofs.proofs.spec.feature))).toBe(true);
		expect(
			existsSync(
				join(REPO_ROOT, ".maina/receipts", proofs.proofs.receipt.hash),
			),
		).toBe(true);
	});

	it("claims no routing savings: there is no routing data yet", () => {
		const kinds: readonly string[] = PROOFS.items.map((p) => p.kind);
		expect(kinds).not.toContain("routing");
		expect(JSON.stringify(LANDING)).not.toMatch(/saved \$\d/i);
	});
});

describe("navigation", () => {
	it("points every in-page link at a section that exists", () => {
		const anchors = HOME_NAV.links
			.map((l) => l.href)
			.filter((h) => h.startsWith("#"))
			.map((h) => h.slice(1));
		for (const a of anchors) {
			expect(SECTION_IDS as readonly string[]).toContain(a);
		}
	});
});
