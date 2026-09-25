/**
 * doctor v2 probe (FR-INS-6): the imperative half. A launched server must
 * never be able to hang `maina doctor`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeMcp } from "../probe";

/** Answers `initialize`, then ignores SIGTERM and stays alive. */
const STUBBORN_SERVER = `
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
let buf = "";
process.stdin.on("data", (chunk) => {
	buf += chunk;
	const nl = buf.indexOf("\\n");
	if (nl < 0) return;
	const msg = JSON.parse(buf.slice(0, nl));
	process.stdout.write(JSON.stringify({
		jsonrpc: "2.0",
		id: msg.id,
		result: {
			protocolVersion: "2024-11-05",
			serverInfo: { name: "maina", version: "9.9.9" },
		},
	}) + "\\n");
});
`;

describe("probeMcp", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "maina-probe-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("a server that ignores SIGTERM does not hang the probe", async () => {
		const script = join(dir, "stubborn.cjs");
		writeFileSync(script, STUBBORN_SERVER);

		const outcome = await probeMcp(
			{ command: process.execPath, args: [script], env: {} },
			{ PATH: "/usr/bin:/bin", HOME: dir },
			dir,
		);

		expect(outcome.kind).toBe("ready");
		if (outcome.kind === "ready") expect(outcome.serverVersion).toBe("9.9.9");
	}, 8_000);
});
