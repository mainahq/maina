#!/usr/bin/env bun
/**
 * MCP cold-start bench for the release evidence (spec §8, #558): spawns the
 * built CLI's MCP server (`maina --mcp`, as every host entry launches it)
 * as a fresh process, `samples` times, in a throwaway project and HOME, and
 * times spawn → `initialize` response with the real-config e2e probe
 * (`ci/e2e/real-config/matrix.ts`). Budget: 1,500 ms.
 *
 *   bun run build   # (or: cd packages/cli && bun run build)
 *   bun scripts/release/evidence/mcp-cold-start.ts [--samples 10] [--json <file>]
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { probeLaunch } from "../../../ci/e2e/real-config/matrix";
import { summarizeColdStarts } from "./latency";
import { flag } from "./shell";

const root = resolve(import.meta.dir, "../../..");
const argv = process.argv.slice(2);
const samples = Number(flag(argv, "--samples") ?? 10);
const json = flag(argv, "--json");
const cli = join(root, "packages/cli/dist/index.js");

const base = mkdtempSync(join(tmpdir(), "maina-mcp-cold-"));
const home = join(base, "home");
const project = join(base, "project");
mkdirSync(home, { recursive: true });
mkdirSync(project, { recursive: true });
Bun.spawnSync(["git", "init", "-q"], { cwd: project });

const times: number[] = [];
const failures: string[] = [];
try {
	for (let i = 0; i < samples; i++) {
		const r = await probeLaunch(
			{ command: process.execPath, args: [cli, "--mcp"], env: {}, source: cli },
			{ PATH: process.env.PATH ?? "", HOME: home },
			project,
		);
		if (r.started && r.handshakeMs !== null) times.push(r.handshakeMs);
		else failures.push(r.error?.message ?? "did not start");
	}
} finally {
	rmSync(base, { recursive: true, force: true });
}

const summary = summarizeColdStarts(times);
for (const f of [...new Set(failures)]) {
	process.stderr.write(`mcp cold start: ${f}\n`);
}
if (!summary.ok) {
	process.stderr.write(`mcp cold start: ${summary.error}\n`);
	process.exit(1);
}
process.stdout.write(
	`MCP cold start over ${times.length} spawns: p95 ${summary.value.p95Ms} ms, max ${summary.value.maxMs} ms\n`,
);
if (json !== undefined) {
	writeFileSync(
		json,
		`${JSON.stringify({ ...summary.value, failures: failures.length }, null, "\t")}\n`,
	);
}
process.exit(failures.length === 0 ? 0 : 1);
