/**
 * What the plugin cells measure for the v1 release evidence (spec §9.1,
 * #558): the time from a clean install to the first result, and what an
 * uninstall leaves behind, per marketplace host.
 *
 * When `MAINA_E2E_MEASUREMENTS` names a file, each measured case appends
 * one JSON line to it, passing or failing, and the release-evidence
 * workflow folds the lines into `first-result.json` and `uninstall.json`
 * (`scripts/release/evidence/e2e.ts`). Without it nothing is written.
 */

import { appendFileSync } from "node:fs";
import type { Os } from "./env";

/** A marketplace listing's host, as `scripts/release/lockstep.ts` names it. */
export type Marketplace = "claude" | "cursor" | "codex";

export const MARKETPLACE_HOSTS: readonly Marketplace[] = [
	"claude",
	"cursor",
	"codex",
];

export type FirstResultMeasurement = Readonly<{
	kind: "first-result";
	host: Marketplace;
	os: Os;
	/** Install → first session → first `verify` answer. */
	seconds: number;
	/** Every step of the case held. */
	ok: boolean;
}>;

export type UninstallMeasurement = Readonly<{
	kind: "uninstall";
	host: Marketplace;
	os: Os;
	/** What install → use → uninstall left behind; empty is clean. */
	traces: readonly string[];
}>;

export type Measurement = FirstResultMeasurement | UninstallMeasurement;

const currentOs = (): Os =>
	process.platform === "darwin" ? "darwin" : "linux";

function record(m: Measurement, file: string | undefined): void {
	if (file === undefined || file === "") return;
	appendFileSync(file, `${JSON.stringify(m)}\n`);
}

const message = (e: unknown): string =>
	e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e);

/**
 * Runs a first-result case and records how long it took and whether it
 * held. The case's own assertions still decide the test.
 */
export async function measureFirstResult(
	host: Marketplace,
	run: () => Promise<void>,
	file: string | undefined = process.env.MAINA_E2E_MEASUREMENTS,
): Promise<void> {
	const t0 = performance.now();
	let ok = false;
	try {
		await run();
		ok = true;
	} finally {
		const seconds = Math.round((performance.now() - t0) / 100) / 10;
		record({ kind: "first-result", host, os: currentOs(), seconds, ok }, file);
	}
}

/**
 * Runs an uninstall case, which calls `report` with what it found left
 * behind before asserting it is nothing. A case that fails before it gets
 * that far records why, so a broken case never reads as a clean one.
 */
export async function measureUninstall(
	host: Marketplace,
	run: (report: (traces: readonly string[]) => void) => Promise<void>,
	file: string | undefined = process.env.MAINA_E2E_MEASUREMENTS,
): Promise<void> {
	let found: readonly string[] | undefined;
	try {
		await run((traces) => {
			found = traces;
		});
	} catch (e) {
		if (found === undefined) {
			found = [
				`the uninstall case failed before its trace check: ${message(e)}`,
			];
		}
		throw e;
	} finally {
		record(
			{
				kind: "uninstall",
				host,
				os: currentOs(),
				traces: found ?? ["the uninstall case never reported its traces"],
			},
			file,
		);
	}
}
