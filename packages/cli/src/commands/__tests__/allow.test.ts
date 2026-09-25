/**
 * `maina allow <decision-id> [--always]` (FR-GATE-8, FR-DEC-4): records that
 * the user overrode a gate decision and, with `--always`, remembers it as a
 * scoped rule in the user policy (`~/.maina/policy.json`), never in the repo
 * policy. Driven against real temp HOME and repo directories.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendDecision,
	type DbPort,
	type GateSubject,
	hashValue,
	queryOutcomes,
	recordGateSubject,
} from "@mainahq/core";
import { openDecisionDb } from "../../decision-store";
import { nodeFs } from "../../ports";
import { allowAction } from "../allow";

let home: string;
let repo: string;
let db: DbPort;
let close: () => void;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "maina-312-home-"));
	repo = mkdtempSync(join(tmpdir(), "maina-312-repo-"));
	// The real store: `.maina/decisions.db`, migrated on open.
	const opened = openDecisionDb(join(repo, ".maina"));
	if (!opened.ok) throw new Error(opened.error);
	db = opened.value.db;
	close = opened.value.close;
});

afterEach(() => {
	close();
	rmSync(home, { recursive: true, force: true });
	rmSync(repo, { recursive: true, force: true });
});

function logGateDecision(id: string, subject: Partial<GateSubject> = {}): void {
	const appended = appendDecision(
		{ db },
		{
			id,
			ts: 1_000,
			type: "action.risk",
			inputHash: hashValue(`input:${id}`),
			schemaHash: hashValue("schema"),
			optionOrder: ["allow", "ask", "deny"],
			policyHash: hashValue("policy"),
			modelHash: hashValue("model"),
			distribution: [
				{ answer: "allow", p: 0.1 },
				{ answer: "ask", p: 0.8 },
				{ answer: "deny", p: 0.1 },
			],
			answer: "ask",
			finalAction: "ask",
			latencyMs: 3,
		},
	);
	expect(appended.ok).toBe(true);
	const recorded = recordGateSubject(db, {
		decisionId: id,
		kind: "shell",
		targets: ["git push origin main"],
		classes: ["git.push", "git.push.protected"],
		rule: "ask",
		irreversible: false,
		...subject,
	});
	expect(recorded.ok).toBe(true);
}

async function run(decisionId: string, always = false) {
	const out: string[] = [];
	const result = await allowAction(
		{ decisionId, always },
		{
			db,
			fs: nodeFs,
			home,
			clock: { now: () => 5_000 },
			print: (text) => out.push(text),
		},
	);
	return { result, text: out.join("\n") };
}

const userPolicy = () => join(home, ".maina", "policy.json");
const repoPolicy = () => join(repo, ".maina", "policy.json");

describe("maina allow", () => {
	test("an override links an `override` outcome to the decision", async () => {
		logGateDecision("d-1");
		const { result, text } = await run("d-1");
		expect(result.ok).toBe(true);
		const outcomes = queryOutcomes({ db }, { decisionId: "d-1" });
		expect(outcomes.ok && outcomes.value.map((o) => o.outcome)).toEqual([
			"override",
		]);
		expect(text).toContain("d-1");
		expect(text.split("\n")).toHaveLength(1);
		// Without --always nothing is remembered.
		expect(existsSync(userPolicy())).toBe(false);
	});

	test("--always writes a scoped user policy rule, never a repo rule", async () => {
		mkdirSync(join(repo, ".maina"), { recursive: true });
		const repoContent = JSON.stringify({ rules: { allow: [] } });
		writeFileSync(repoPolicy(), repoContent);
		logGateDecision("d-2");

		const { result, text } = await run("d-2", true);
		expect(result.ok).toBe(true);

		const user = JSON.parse(readFileSync(userPolicy(), "utf8"));
		expect(user.rules.allow).toEqual([
			{
				match: "git push origin main",
				kind: "shell",
				reason: "allowed with maina allow d-2 --always",
			},
		]);
		expect(readFileSync(repoPolicy(), "utf8")).toBe(repoContent);
		expect(text).toContain(userPolicy());
	});

	test("--always creates no repo policy when the repo has none", async () => {
		logGateDecision("d-3");
		await run("d-3", true);
		expect(existsSync(repoPolicy())).toBe(false);
		expect(existsSync(userPolicy())).toBe(true);
	});

	test("an unknown decision is an error and nothing is written", async () => {
		const { result, text } = await run("d-404", true);
		expect(result.ok).toBe(false);
		expect(text).toContain("d-404");
		expect(existsSync(userPolicy())).toBe(false);
	});

	test("--always on an irreversible action is refused before anything is recorded", async () => {
		logGateDecision("d-4", {
			targets: ["git push --force origin main"],
			classes: ["git.push.force"],
			irreversible: true,
		});
		const { result, text } = await run("d-4", true);
		expect(result.ok).toBe(false);
		expect(text).toContain("irreversible");
		const outcomes = queryOutcomes({ db }, { decisionId: "d-4" });
		expect(outcomes.ok && outcomes.value).toEqual([]);
		expect(existsSync(userPolicy())).toBe(false);
	});
});
