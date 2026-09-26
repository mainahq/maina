/**
 * `maina digest [--week yyyy-ww] [--send]` (#350, FR-RET-5): the week's gate
 * digest from the decision log, a shareable card, and delivery only when
 * `--send` is given and `.maina/config.json` configures a channel.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendDecision,
	type DigestDelivery,
	type DigestEvent,
	hashValue,
	type NetworkRequest,
	recordGateSubject,
	recordOverride,
	type SpawnOptions,
} from "@mainahq/core";
import { openDecisionDb } from "../../decision-store";
import { type DigestDeps, readDecisionEvents, runDigest } from "../digest";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const TS = Date.parse("2026-09-23T10:00:00.000Z");

const EVENTS: readonly DigestEvent[] = [
	{
		ts: TS,
		tool: "shell",
		verdict: "allow",
		rule: "shell.exec",
		override: false,
		crash: false,
	},
	{
		ts: TS,
		tool: "shell",
		verdict: "deny",
		rule: "fs.delete.recursive",
		override: false,
		crash: false,
	},
	{
		ts: TS,
		tool: "file.write",
		verdict: "ask",
		rule: "fs.write.outside",
		override: true,
		crash: false,
	},
];

type Harness = {
	deps: DigestDeps;
	out: () => string;
	err: () => string;
	posts: NetworkRequest[];
	spawns: Array<{ argv: readonly string[]; options: SpawnOptions }>;
	bounds: Array<{ since: number; until: number }>;
};

function harness(
	delivery: DigestDelivery | undefined = undefined,
	postStatus = 200,
): Harness {
	let out = "";
	let err = "";
	const posts: NetworkRequest[] = [];
	const spawns: Harness["spawns"] = [];
	const bounds: Harness["bounds"] = [];
	return {
		out: () => out,
		err: () => err,
		posts,
		spawns,
		bounds,
		deps: {
			root: "/repo",
			now: () => NOW,
			readEvents: (b) => {
				bounds.push(b);
				return { ok: true, value: EVENTS };
			},
			loadDelivery: async () => ({ ok: true, value: delivery }),
			network: {
				post: async (req) => {
					posts.push(req);
					return postStatus < 300
						? { ok: true, value: { status: postStatus } }
						: {
								ok: false,
								error: { kind: "http", url: req.url, status: postStatus },
							};
				},
			},
			process: {
				spawn: async (argv, options) => {
					spawns.push({ argv, options });
					return { ok: true, value: { exitCode: 0, stdout: "", stderr: "" } };
				},
			},
			stdout: (t) => {
				out += t;
			},
			stderr: (t) => {
				err += t;
			},
		},
	};
}

describe("runDigest", () => {
	test("defaults to the current ISO week and reads only its bounds", async () => {
		const h = harness();
		const code = await runDigest({}, h.deps);
		expect(code).toBe(0);
		expect(h.bounds).toEqual([
			{
				since: Date.parse("2026-09-21T00:00:00.000Z"),
				until: Date.parse("2026-09-28T00:00:00.000Z"),
			},
		]);
		expect(h.out()).toContain("# Maina weekly digest 2026-39");
		expect(h.out()).toContain("| deny | 1 |");
	});

	test("prints the shareable card after the report", async () => {
		const h = harness();
		await runDigest({ week: "2026-39" }, h.deps);
		expect(h.out()).toContain(
			"3 agent actions checked: 1 blocked, 1 asked, 1 allowed",
		);
		expect(h.out()).toContain("Most blocked: fs.delete.recursive (1)");
	});

	test("rejects a malformed week", async () => {
		const h = harness();
		const code = await runDigest({ week: "2026-W39" }, h.deps);
		expect(code).toBe(3);
		expect(h.err()).toContain("yyyy-ww");
		expect(h.bounds).toHaveLength(0);
	});

	test("never delivers without --send, even when configured", async () => {
		const h = harness({ webhook: { url: "https://hooks.example.com/x" } });
		await runDigest({ week: "2026-39" }, h.deps);
		expect(h.posts).toHaveLength(0);
		expect(h.spawns).toHaveLength(0);
	});

	test("--send without a configured channel sends nothing and says so", async () => {
		const h = harness();
		const code = await runDigest({ week: "2026-39", send: true }, h.deps);
		expect(code).toBe(0);
		expect(h.posts).toHaveLength(0);
		expect(h.spawns).toHaveLength(0);
		expect(h.out()).toContain("Delivery is off");
	});

	test("--send posts only the card to the configured webhook", async () => {
		const h = harness({ webhook: { url: "https://hooks.example.com/x" } });
		const code = await runDigest({ week: "2026-39", send: true }, h.deps);
		expect(code).toBe(0);
		expect(h.posts).toHaveLength(1);
		const body = JSON.parse(h.posts[0]?.body ?? "") as { text: string };
		expect(body.text).toContain("3 agent actions checked");
		expect(body.text).not.toContain("| verdict |");
		expect(h.out()).toContain("Sent to webhook");
	});

	test("a failed delivery exits 2 and names the channel", async () => {
		const h = harness({ webhook: { url: "https://hooks.example.com/x" } }, 500);
		const code = await runDigest({ week: "2026-39", send: true }, h.deps);
		expect(code).toBe(2);
		expect(h.err()).toContain("webhook: webhook answered HTTP 500");
	});

	test("--json emits the { data, error, meta } envelope", async () => {
		const h = harness();
		const code = await runDigest({ week: "2026-39", json: true }, h.deps);
		expect(code).toBe(0);
		const parsed = JSON.parse(h.out()) as {
			data: {
				week: string;
				digest: { total: number };
				card: string;
				delivery: unknown;
			};
			error: unknown;
			meta: unknown;
		};
		expect(parsed.data.week).toBe("2026-39");
		expect(parsed.data.digest.total).toBe(3);
		expect(parsed.data.card).toContain("3 agent actions checked");
		expect(parsed.data.delivery).toBeNull();
		expect(parsed.error).toBeNull();
	});

	test("a decision log that cannot be read is a failure, not an empty week", async () => {
		const h = harness();
		h.deps = { ...h.deps, readEvents: () => ({ ok: false, error: "corrupt" }) };
		const code = await runDigest({ week: "2026-39" }, h.deps);
		expect(code).toBe(2);
		expect(h.err()).toContain("corrupt");
	});
});

describe("readDecisionEvents", () => {
	let repo: string;

	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), "maina-350-"));
	});

	afterEach(() => {
		rmSync(repo, { recursive: true, force: true });
	});

	test("a repository without a decision log has an empty week and gets no log", () => {
		const mainaDir = join(repo, ".maina");
		const events = readDecisionEvents(mainaDir, { since: 0, until: NOW });
		expect(events).toEqual({ ok: true, value: [] });
		expect(existsSync(join(mainaDir, "decisions.db"))).toBe(false);
	});

	test("reads the week's gate decisions with their subjects and overrides", () => {
		const mainaDir = join(repo, ".maina");
		const opened = openDecisionDb(mainaDir);
		if (!opened.ok) throw new Error(opened.error);
		const { db, close } = opened.value;
		const log = (id: string, ts: number, finalAction: string) => {
			const appended = appendDecision(
				{ db },
				{
					id,
					ts,
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
					finalAction,
					latencyMs: 3,
				},
			);
			expect(appended.ok).toBe(true);
		};
		log("d1", TS, "ask");
		log("d2", TS + 1, "deny");
		// Outside the week.
		log("d3", Date.parse("2026-10-05T00:00:00.000Z"), "deny");
		expect(
			recordGateSubject(db, {
				decisionId: "d1",
				kind: "shell",
				targets: ["git push origin main"],
				classes: ["git.push", "git.push.protected"],
				rule: "ask",
				irreversible: false,
			}).ok,
		).toBe(true);
		expect(recordOverride({ db, clock: { now: () => TS } }, "d1").ok).toBe(
			true,
		);
		close();

		const events = readDecisionEvents(mainaDir, {
			since: Date.parse("2026-09-21T00:00:00.000Z"),
			until: Date.parse("2026-09-28T00:00:00.000Z"),
		});
		expect(events).toEqual({
			ok: true,
			value: [
				{
					ts: TS,
					tool: "shell",
					verdict: "ask",
					rule: "git.push.protected",
					override: true,
					crash: false,
				},
				{
					ts: TS + 1,
					tool: "unknown",
					verdict: "deny",
					rule: "unknown",
					override: false,
					crash: false,
				},
			],
		});
	});
});
