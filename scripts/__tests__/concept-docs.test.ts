/**
 * Concept pages (#359, FR-DOC-4).
 *
 * The Concepts group opens with the v1 concepts: System 1, decisions,
 * policy, receipts and the log, calibration, privacy and the harness. Each
 * page states numbers and names the code owns, so the tests read them from
 * the code: when a default changes, the page has to change with it.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOG_SALT_PATH } from "../../packages/core/src/decide/log/salt";
import { OUTCOMES } from "../../packages/core/src/decide/outcomes/types";
import { DECISION_CATALOG } from "../../packages/core/src/decide/types-catalog";
import {
	DEFAULT_POLICY,
	UNATTENDED_DENIED_ACTION_CLASSES,
} from "../../packages/core/src/policy/defaults";
import {
	DECISION_BACKENDS,
	LOCKED_ACTION_CLASSES,
	VERDICTS,
} from "../../packages/core/src/policy/schema";
import { REDIRECTS, SIDEBAR } from "../../packages/docs/src/navigation";
import { WORKER_NAMES } from "../../packages/harness/src/workers/registry";
import { headingAnchors } from "../docs-links";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const DOCS = join(REPO_ROOT, "packages", "docs", "src", "content", "docs");

const CONCEPTS = [
	"concepts/system-1",
	"concepts/decisions",
	"concepts/policy",
	"concepts/receipts-and-log",
	"concepts/calibration",
	"concepts/privacy",
	"concepts/harness",
] as const;

type Concept = (typeof CONCEPTS)[number];

const read = (slug: Concept): string => {
	const file = join(DOCS, `${slug}.mdx`);
	return existsSync(file) ? readFileSync(file, "utf-8") : "";
};

/** The page's text between its frontmatter and the end. */
const frontmatter = (text: string): string =>
	/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";

const percent = (n: number): string => `${Math.round(n * 100)}%`;

describe("concept pages", () => {
	test("each exists with a title and a description", () => {
		for (const slug of CONCEPTS) {
			const fm = frontmatter(read(slug));
			expect({ slug, title: /^title:\s*\S/m.test(fm) }).toEqual({
				slug,
				title: true,
			});
			expect({ slug, description: /^description:\s*\S/m.test(fm) }).toEqual({
				slug,
				description: true,
			});
		}
	});

	test("open the Concepts group, in order", () => {
		const group = SIDEBAR.find((g) => g.label === "Concepts");
		const slugs = (group?.items ?? []).map((item) =>
			"slug" in item ? item.slug : undefined,
		);
		expect(slugs.slice(0, CONCEPTS.length)).toEqual([...CONCEPTS]);
	});

	test("the privacy page moved under concepts and its old URL redirects", () => {
		expect(existsSync(join(DOCS, "privacy.mdx"))).toBe(false);
		expect(REDIRECTS["/privacy"]).toBe("/concepts/privacy/");
	});
});

describe("System 1", () => {
	const text = read("concepts/system-1");

	test("names the policy backend and says what answers until a model ships", () => {
		expect(text).toContain('"backend": "system1"');
		expect(text).toContain("maina doctor");
		expect(text).toMatch(/heuristic/);
	});

	test("links on to decisions and calibration", () => {
		expect(text).toContain("](/concepts/decisions/)");
		expect(text).toContain("](/concepts/calibration/)");
	});
});

describe("decisions", () => {
	const text = read("concepts/decisions");

	test("names every backend and every question kind", () => {
		for (const backend of DECISION_BACKENDS) {
			expect({ backend, named: text.includes(`\`${backend}\``) }).toEqual({
				backend,
				named: true,
			});
		}
		for (const kind of ["choice", "score", "bool"]) {
			expect({ kind, named: text.includes(`\`${kind}\``) }).toEqual({
				kind,
				named: true,
			});
		}
	});

	test("states the decision type count from the catalog and links the reference", () => {
		const count = Object.keys(DECISION_CATALOG).length;
		expect(text).toContain("facts.decisionTypes.count");
		expect(count).toBeGreaterThan(0);
		expect(text).toContain("](/reference/decision-types/)");
	});
});

describe("policy", () => {
	const text = read("concepts/policy");

	test("names both policy files, every verdict and the locked class", () => {
		expect(text).toContain("`~/.maina/policy.json`");
		expect(text).toContain("`.maina/policy.json`");
		for (const verdict of VERDICTS) {
			expect({ verdict, named: text.includes(`\`${verdict}\``) }).toEqual({
				verdict,
				named: true,
			});
		}
		for (const locked of LOCKED_ACTION_CLASSES) {
			expect(text).toContain(`\`${locked}\``);
		}
		expect(text).toContain("`explicitly_allow`");
		expect(text).toContain("maina allow");
		expect(text).toContain("](/reference/policy/)");
	});

	test("states the default confidence thresholds", () => {
		const risk = DEFAULT_POLICY.decisions["action.risk"].thresholds.confidence;
		const other = DEFAULT_POLICY.decisions.slop.thresholds.confidence;
		expect(text).toContain(String(risk));
		expect(text).toContain(String(other));
	});
});

describe("receipts and the log", () => {
	const text = read("concepts/receipts-and-log");

	test("names where receipts, run receipts and the decision log live", () => {
		expect(text).toContain("`.maina/receipts/`");
		expect(text).toContain("`.maina/runs/`");
		expect(text).toContain("`.maina/decisions.db`");
		expect(text).toContain("maina verify-receipt");
	});

	test("says the log is append-only and hashes paths by default", () => {
		expect(text).toMatch(/append-only/);
		expect(DEFAULT_POLICY.log.paths).toBe("hashed");
		expect(text).toContain("`log.paths`");
		expect(text).toContain(`\`${LOG_SALT_PATH}\``);
	});
});

describe("calibration", () => {
	const text = read("concepts/calibration");

	test("names every outcome the log links", () => {
		for (const outcome of OUTCOMES) {
			expect({ outcome, named: text.includes(`\`${outcome}\``) }).toEqual({
				outcome,
				named: true,
			});
		}
	});

	test("states the drift guard's defaults", () => {
		const { window, max_error_rate, max_confidence_drop } =
			DEFAULT_POLICY.drift;
		expect(text).toContain(`${window} decisions`);
		expect(text).toContain(percent(max_error_rate));
		expect(text).toContain(percent(max_confidence_drop));
	});
});

describe("privacy", () => {
	const text = read("concepts/privacy");

	test("renders the telemetry summary from the facts module", () => {
		expect(text).toContain("{facts.telemetry.summary}");
	});

	test("covers the decision log's local-only hashing", () => {
		expect(text).toContain("`log.paths`");
		expect(text).toContain(`\`${LOG_SALT_PATH}\``);
		// Self-hosting links here: the anchor must survive the move.
		expect([...headingAnchors(text)]).toContain("remote-connector");
	});
});

describe("harness", () => {
	const text = read("concepts/harness");

	test("covers maina run and maina acp with every worker", () => {
		expect(text).toContain("maina run");
		expect(text).toContain("maina acp");
		for (const worker of WORKER_NAMES) {
			expect({ worker, named: text.includes(`\`${worker}\``) }).toEqual({
				worker,
				named: true,
			});
		}
	});

	test("states the unattended denials and budgets from the default policy", () => {
		for (const cls of UNATTENDED_DENIED_ACTION_CLASSES) {
			expect({ cls, named: text.includes(`\`${cls}\``) }).toEqual({
				cls,
				named: true,
			});
		}
		const { wall_clock_minutes, max_tool_calls } =
			DEFAULT_POLICY.run.unattended.budgets;
		expect(text).toContain(`${wall_clock_minutes} minutes`);
		expect(text).toContain(`${max_tool_calls} tool calls`);
	});

	test("says plugin-only users get the hooks, not the sandbox", () => {
		const anchors = [...headingAnchors(text)];
		expect(anchors).toContain("plugins-get-hooks-not-the-sandbox");
	});
});

describe("hook failures", () => {
	// Claude Code and Codex have no fail-closed hook setting: a hook that
	// crashes or times out lets the action through. Only Cursor's
	// `failClosed` blocks it (packages/plugins/src/generate/{claude,codex}.ts,
	// packages/runtime/src/adapters/cursor.ts). No page may promise more.
	const OVERCLAIM = /blocking hook that crashes or times out blocks/i;

	for (const slug of ["concepts/harness", "concepts/policy"] as const) {
		test(`${slug} does not promise every host fails closed on a hook crash`, () => {
			const text = read(slug);
			expect(OVERCLAIM.test(text)).toBe(false);
			expect(text).toContain("`failClosed`");
			expect(text).toMatch(/Claude Code and Codex[^.]*fail open/);
		});
	}
});
