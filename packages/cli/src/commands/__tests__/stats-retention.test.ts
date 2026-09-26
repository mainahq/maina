/**
 * `maina stats --retention` (FR-RET-7): the local retention view, and the
 * opt-in share behind `--share` (FR-PRIV-1).
 */

import { describe, expect, test } from "bun:test";
import type { FsPort, NetworkPort, NetworkRequest } from "@mainahq/core";
import { formatRetention, type RetentionDeps, retentionAction } from "../stats";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 9, 0, 0);
const HOME = "/home/dev";
const LOG = `${HOME}/.maina/retention.jsonl`;

function memoryFs(files: Record<string, string>): FsPort {
	const map = new Map(Object.entries(files));
	return {
		readFile: async (path) => {
			const content = map.get(path);
			return content === undefined
				? { ok: false, error: { kind: "not_found", path } }
				: { ok: true, value: content };
		},
		writeFile: async (path, content) => {
			map.set(path, content);
			return { ok: true, value: undefined };
		},
		exists: async (path) => map.has(path),
		readDir: async () => ({ ok: true, value: [] }),
		remove: async (path) => {
			map.delete(path);
			return { ok: true, value: undefined };
		},
	};
}

function spy(): NetworkPort & { calls: NetworkRequest[] } {
	const calls: NetworkRequest[] = [];
	return {
		calls,
		post: async (request) => {
			calls.push(request);
			return { ok: true, value: { status: 202 } };
		},
	};
}

const HISTORY = [
	{ kind: "session", ts: T0, host: "claude-code" },
	{ kind: "surface", ts: T0 + 5 * DAY, surface: "digest" },
	{ kind: "session", ts: T0 + 8 * DAY, host: "claude-code" },
]
	.map((e) => `${JSON.stringify(e)}\n`)
	.join("");

function deps(
	files: Record<string, string>,
	env: Record<string, string> = {},
): RetentionDeps & { network: ReturnType<typeof spy> } {
	const fs = memoryFs(files);
	return {
		fs,
		home: HOME,
		now: () => T0 + 20 * DAY,
		env: { get: (name) => ({ HOME, ...env })[name] },
		network: spy(),
		baseUrl: "https://cloud.test",
	};
}

describe("maina stats --retention", () => {
	test("reads the local history and computes the day-7 return", async () => {
		const d = deps({ [LOG]: HISTORY });
		const result = await retentionAction({}, d);
		expect(result.file).toBe(LOG);
		expect(result.report?.day7.status).toBe("returned");
		expect(result.report?.day7.sessions[0]?.surface).toBe("digest");
		expect(result.share).toBeUndefined();
		expect(d.network.calls).toEqual([]);
	});

	test("the view shows both windows and the attribution", async () => {
		const result = await retentionAction({}, deps({ [LOG]: HISTORY }));
		const text = formatRetention(result);
		expect(text).toContain("First session: 2026-09-01");
		expect(text).toContain("Day 7:  returned on 2026-09-09 (after digest)");
		expect(text).toContain("Day 28: pending (window 2026-09-29 to 2026-10-06)");
		expect(text).toContain("digest 1");
		expect(text).toContain("stays on this machine");
	});

	test("no history yet says how it starts", async () => {
		const result = await retentionAction({}, deps({}));
		expect(result.report).toBeNull();
		expect(formatRetention(result)).toContain("No sessions recorded yet");
	});

	test("--share without the usage opt-in sends nothing", async () => {
		const d = deps({ [LOG]: HISTORY });
		const result = await retentionAction({ share: true }, d);
		expect(result.share).toEqual({ sent: 0, skipped: "not_opted_in" });
		expect(d.network.calls).toEqual([]);
		expect(formatRetention(result)).toContain("telemetry.usage");
	});

	test("--share with the usage opt-in posts the summary once", async () => {
		const d = deps({
			[LOG]: HISTORY,
			[`${HOME}/.maina/policy.json`]: JSON.stringify({
				telemetry: { usage: true },
			}),
		});
		const result = await retentionAction({ share: true }, d);
		expect(result.share).toEqual({ sent: 1 });
		expect(d.network.calls.map((c) => c.url)).toEqual([
			"https://cloud.test/v1/retention",
		]);
	});

	test("--json is one { data, error, meta } document", async () => {
		const result = await retentionAction({}, deps({ [LOG]: HISTORY }));
		const doc = JSON.parse(formatRetention(result, { json: true }));
		expect(doc.error).toBeNull();
		expect(doc.data.report.day7.status).toBe("returned");
		expect(doc.meta).toEqual({ schemaVersion: "v1" });
	});
});
