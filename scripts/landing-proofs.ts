#!/usr/bin/env bun
/**
 * The landing page's proofs, computed from this repo (#360, FR-DOC-7).
 *
 * Every verdict, count and receipt `/` shows comes from here, never from
 * hand-written demo data:
 *
 * - **gate**: each try-the-gate preset and ledger row in `landing.ts`, run
 *   through `evaluateGate` under the default policy with the real bash
 *   grammar, and the whole shell corpus as the try-your-own lookup table.
 * - **corpus**: what the rules alone gate in the labelled command corpus.
 * - **blocked**: a dogfood case the rules deny (#447, an agent approving its
 *   own gated action).
 * - **spec**: an error the spec analyzer finds in a real feature directory.
 * - **receipt**: the newest committed verification receipt.
 *
 * No routing-savings proof: there is no routing data yet, and a number the
 * repo cannot back is not shown.
 *
 *   bun scripts/landing-proofs.ts           write both files
 *   bun scripts/landing-proofs.ts --check   exit 1 when either is stale
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_REGISTRY } from "../packages/core/src/decide/registry";
import { analyze } from "../packages/core/src/features/analyzer";
import { evaluateGate } from "../packages/core/src/gate/evaluate";
import type { GateContext, GateEvent } from "../packages/core/src/gate/events";
import { loadShellParser } from "../packages/core/src/gate/parsers/shell";
import { evaluateRules } from "../packages/core/src/gate/rules";
import { DEFAULT_POLICY } from "../packages/core/src/policy/defaults";
import { GATE } from "../packages/docs/src/data/landing";
import type {
	CorpusRow,
	GateRow,
	LandingProofs,
	Verdict,
} from "../packages/docs/src/data/landing-proofs";
import {
	buildGallery,
	type RawReceipt,
} from "../packages/docs/src/data/receipts-gallery";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const PROOFS_FILE = "packages/docs/src/data/landing-proofs.json";
const CORPUS_FILE = "packages/docs/public/gate-corpus.json";
const FIXTURES = "packages/core/src/gate/__fixtures__/commands.jsonl";
const RECEIPTS = ".maina/receipts";

/** The dogfood case the blocked proof shows, and the issue that found it. */
const BLOCKED = { fixture: "d-394", issue: 447 } as const;
/** The feature directory the spec proof reads. */
const SPEC_FEATURE = ".maina/features/001-stats-tracker";

/** The workspace and home the corpus fixtures are written against. */
const ROOT = "/work/repo";
const HOME = "/home/dev";
const AGENTS = ["claude-code", "codex", "cursor"] as const;

type Fixture = Readonly<{
	id: string;
	label: "destructive" | "reversible" | "benign";
	obfuscated: boolean;
	kind: GateEvent["kind"];
	action: Readonly<Record<string, unknown>>;
	source?: string;
	branch?: string;
}>;

type Outcome = Readonly<{ row: GateRow; fixture?: Fixture }>;

function readFixtures(root: string): Fixture[] {
	return readFileSync(join(root, FIXTURES), "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Fixture);
}

function event(kind: GateEvent["kind"], action: unknown): GateEvent {
	return {
		host: "claude-code",
		sessionId: "landing",
		root: ROOT,
		permissionMode: "default",
		untrusted: [],
		kind,
		action,
	} as unknown as GateEvent;
}

const VERDICTS: readonly Verdict[] = ["allow", "ask", "deny"];

/** One evaluation of `ev` by the rules and the whole gate, as a row. */
function evaluate(
	ctx: GateContext,
	ev: GateEvent,
	id: string,
	label: string,
	agent: string,
): GateRow {
	const rules = evaluateRules(ev, DEFAULT_POLICY, ctx);
	let n = 0;
	const gate = evaluateGate(
		{
			clock: { now: () => 0 },
			backends: DEFAULT_REGISTRY,
			ctx,
			newId: () => `landing-${++n}`,
		},
		ev,
		DEFAULT_POLICY,
	);
	const decision = gate.decided?.answers[0]?.decision;
	const distribution = VERDICTS.map((answer) => ({
		answer,
		p: decision?.distribution.find((d) => d.answer === answer)?.p ?? 0,
	}));
	return {
		id,
		label,
		agent,
		verdict: gate.verdict,
		rule: rules.kind,
		reason: gate.reason,
		classes: [...rules.classes],
		distribution,
		backend: decision?.backend.id ?? "none",
	};
}

const fixtureLabel = (f: Fixture): string => {
	const a = f.action;
	if (typeof a.command === "string") return a.command;
	if (typeof a.path === "string") return `${f.kind} ${a.path}`;
	if (typeof a.url === "string") return `${f.kind} ${a.url}`;
	return `${f.kind} ${String(a.server ?? "")}.${String(a.tool ?? "")}`;
};

const normalize = (command: string): string =>
	command.trim().replace(/\s+/g, " ");

function corpusStats(outcomes: readonly Outcome[]): LandingProofs["corpus"] {
	const held = (o: Outcome) => o.row.rule === "ask" || o.row.rule === "deny";
	const of = (keep: (f: Fixture) => boolean) =>
		outcomes.filter((o) => o.fixture !== undefined && keep(o.fixture));
	const destructive = of((f) => f.label === "destructive");
	const obfuscated = of((f) => f.obfuscated);
	const selfOverride = of((f) => f.source === "self-override");
	const benign = of((f) => f.label !== "destructive");
	return {
		destructive: {
			total: destructive.length,
			held: destructive.filter(held).length,
		},
		obfuscated: {
			total: obfuscated.length,
			held: obfuscated.filter(held).length,
		},
		selfOverride: {
			total: selfOverride.length,
			denied: selfOverride.filter((o) => o.row.verdict === "deny").length,
		},
		benign: { total: benign.length, flagged: benign.filter(held).length },
	};
}

function specProof(root: string): Result<LandingProofs["proofs"]["spec"]> {
	const report = analyze(join(root, SPEC_FEATURE));
	if (!report.ok) return { ok: false, error: report.error };
	const finding = report.value.findings.find(
		(f) => f.category === "spec-coverage" && f.severity === "error",
	);
	if (finding === undefined) {
		return {
			ok: false,
			error: `${SPEC_FEATURE}: the analyzer found no spec-coverage error`,
		};
	}
	return {
		ok: true,
		value: {
			feature: SPEC_FEATURE,
			category: finding.category,
			severity: finding.severity,
			message: finding.message,
			errors: report.value.summary.errors,
			warnings: report.value.summary.warnings,
		},
	};
}

function receiptProof(
	root: string,
): Result<LandingProofs["proofs"]["receipt"]> {
	const dir = join(root, RECEIPTS);
	if (!existsSync(dir)) return { ok: false, error: `${RECEIPTS} is missing` };
	const raws = readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => join(dir, e.name, "receipt.json"))
		.filter((p) => existsSync(p))
		.map((p) => JSON.parse(readFileSync(p, "utf8")) as RawReceipt);
	const [card] = buildGallery(raws, { limit: 1 });
	const raw = raws.find((r) => r.hash === card?.hash);
	if (card === undefined || raw === undefined) {
		return { ok: false, error: `no valid receipt in ${RECEIPTS}` };
	}
	const checks = (raw.checks ?? []).map((c) => {
		const check = c as {
			name?: unknown;
			status?: unknown;
			findings?: unknown;
		};
		return {
			name: typeof check.name === "string" ? check.name : "check",
			status: typeof check.status === "string" ? check.status : "unknown",
			findings: Array.isArray(check.findings) ? check.findings.length : 0,
		};
	});
	return {
		ok: true,
		value: {
			hash: card.hash,
			hashShort: card.hashShort,
			prTitle: card.prTitle,
			status: card.status,
			statusLabel: card.statusLabel,
			timestamp: card.timestamp,
			diffSummary: card.diffSummary,
			href: card.href,
			passed: card.passed,
			total: card.total,
			checks,
		},
	};
}

export type LandingOutput = Readonly<{
	proofs: LandingProofs;
	corpus: readonly CorpusRow[];
}>;

/** Both files' content, from the engines and this repo. */
export async function computeLandingProofs(
	root: string,
): Promise<Result<LandingOutput>> {
	const parser = await loadShellParser();
	if (!parser.ok) {
		return { ok: false, error: `bash grammar: ${parser.error.message}` };
	}
	const base: GateContext = { shell: parser.value, home: HOME };
	const fixtures = readFixtures(root);

	const outcomes: Outcome[] = fixtures.map((f, i) => ({
		fixture: f,
		row: evaluate(
			f.branch ? { ...base, currentBranch: f.branch } : base,
			event(f.kind, f.action),
			f.id,
			fixtureLabel(f),
			AGENTS[i % AGENTS.length] ?? "claude-code",
		),
	}));
	const byId = new Map(outcomes.map((o) => [o.row.id, o]));

	const presets: Record<string, GateRow> = {};
	for (const p of GATE.presets) {
		presets[p.id] = evaluate(
			base,
			event("shell", { command: p.label }),
			p.id,
			p.label,
			p.agent,
		);
	}

	const ledger: GateRow[] = [];
	for (const id of GATE.ledger.fixtures) {
		const found = byId.get(id);
		if (found === undefined) {
			return { ok: false, error: `ledger fixture ${id} is not in ${FIXTURES}` };
		}
		ledger.push(found.row);
	}

	const blocked = byId.get(BLOCKED.fixture)?.row;
	if (blocked === undefined || blocked.verdict !== "deny") {
		return {
			ok: false,
			error: `${BLOCKED.fixture} must exist and be denied (got ${blocked?.verdict})`,
		};
	}

	const spec = specProof(root);
	if (!spec.ok) return spec;
	const receipt = receiptProof(root);
	if (!receipt.ok) return receipt;

	const seen = new Set<string>();
	const corpus: CorpusRow[] = [];
	const shellRows = [
		...Object.values(presets),
		...outcomes.filter((o) => o.fixture?.kind === "shell").map((o) => o.row),
	];
	for (const row of shellRows) {
		const key = normalize(row.label);
		if (seen.has(key)) continue;
		seen.add(key);
		corpus.push({
			c: row.label,
			v: row.verdict,
			r: row.reason,
			k: row.classes,
		});
	}

	return {
		ok: true,
		value: {
			proofs: {
				gate: {
					backend: DEFAULT_POLICY.decisions["action.risk"].backend,
					threshold:
						DEFAULT_POLICY.decisions["action.risk"].thresholds.confidence,
					presets,
					ledger,
				},
				corpus: corpusStats(outcomes),
				proofs: {
					blocked: {
						command: blocked.label,
						verdict: blocked.verdict,
						reason: blocked.reason,
						classes: blocked.classes,
						fixture: BLOCKED.fixture,
						source: FIXTURES,
						issue: BLOCKED.issue,
					},
					spec: spec.value,
					receipt: receipt.value,
				},
			},
			corpus,
		},
	};
}

const render = (value: unknown): string =>
	`${JSON.stringify(value, null, 2)}\n`;

/** One row per line: the table is fetched by the page, so keep it small. */
const renderRows = (rows: readonly unknown[]): string =>
	`[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;

function rendered(output: LandingOutput): Readonly<Record<string, string>> {
	return {
		[PROOFS_FILE]: render(output.proofs),
		[CORPUS_FILE]: renderRows(output.corpus),
	};
}

/** Files whose committed content differs from what the engines produce. */
export async function staleLandingProofs(root: string): Promise<string[]> {
	const output = await computeLandingProofs(root);
	if (!output.ok) return [`landing proofs: ${output.error}`];
	return Object.entries(rendered(output.value))
		.filter(([rel, content]) => {
			const path = join(root, rel);
			return !existsSync(path) || readFileSync(path, "utf8") !== content;
		})
		.map(([rel]) => rel);
}

async function main(): Promise<number> {
	const root = join(import.meta.dir, "..");
	if (process.argv.includes("--check")) {
		const stale = await staleLandingProofs(root);
		if (stale.length === 0) {
			process.stdout.write("landing-proofs: OK: up to date.\n");
			return 0;
		}
		process.stderr.write(
			`landing-proofs: stale, run \`bun scripts/landing-proofs.ts\`:\n${stale.map((s) => `  ${s}`).join("\n")}\n`,
		);
		return 1;
	}
	const output = await computeLandingProofs(root);
	if (!output.ok) {
		process.stderr.write(`landing-proofs: ${output.error}\n`);
		return 1;
	}
	for (const [rel, content] of Object.entries(rendered(output.value))) {
		writeFileSync(join(root, rel), content, "utf8");
		process.stdout.write(`wrote ${rel}\n`);
	}
	return 0;
}

if (import.meta.main) {
	process.exit(await main());
}
