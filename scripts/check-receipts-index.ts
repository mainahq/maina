#!/usr/bin/env bun
/**
 * Receipts index link-integrity guard (#269).
 *
 * Parses `.maina/receipts/index.html`, extracts every per-receipt link
 * (`href="./<64-hex>/index.html"`), and asserts:
 *   1. every linked hash directory exists on disk under `.maina/receipts/`
 *   2. each directory contains both `index.html` and `receipt.json`
 *   3. no link is duplicated
 *   4. the index file itself exists when the receipts directory does
 *
 * Exits 0 on clean, 1 on any failure (prints the offending hashes for
 * grep-to-IDE navigation). The Pages workflow runs this before staging
 * receipts under `dist/` so we never publish a 404 to mainahq.com.
 *
 * Run manually:
 *     bun scripts/check-receipts-index.ts
 *
 * CI wires this in via the docs.yml "Stage receipts" step.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RECEIPTS_DIR = ".maina/receipts";
const INDEX_PATH = join(RECEIPTS_DIR, "index.html");
const HASH_HREF = /href="\.\/([0-9a-f]{64})\/index\.html"/g;

interface CheckResult {
	missingDirs: string[];
	missingHtml: string[];
	missingJson: string[];
	duplicateHashes: string[];
}

export function checkReceiptsIndex(
	indexPath: string,
	receiptsDir: string,
): CheckResult {
	const result: CheckResult = {
		missingDirs: [],
		missingHtml: [],
		missingJson: [],
		duplicateHashes: [],
	};

	const html = readFileSync(indexPath, "utf-8");
	const matches = [...html.matchAll(HASH_HREF)];
	const hashes = matches.map((m) => m[1]).filter((h): h is string => !!h);

	const seen = new Set<string>();
	for (const hash of hashes) {
		if (seen.has(hash)) {
			result.duplicateHashes.push(hash);
			continue;
		}
		seen.add(hash);

		const dir = join(receiptsDir, hash);
		if (!existsSync(dir) || !statSync(dir).isDirectory()) {
			result.missingDirs.push(hash);
			continue;
		}
		if (!existsSync(join(dir, "index.html"))) result.missingHtml.push(hash);
		if (!existsSync(join(dir, "receipt.json"))) result.missingJson.push(hash);
	}
	return result;
}

export function isClean(r: CheckResult): boolean {
	return (
		r.missingDirs.length === 0 &&
		r.missingHtml.length === 0 &&
		r.missingJson.length === 0 &&
		r.duplicateHashes.length === 0
	);
}

function reportAndExit(r: CheckResult, total: number): never {
	if (isClean(r)) {
		process.stdout.write(
			`Receipt index integrity: ${total} link(s) checked, all resolve.\n`,
		);
		process.exit(0);
	}
	process.stderr.write("Receipt index integrity FAILED:\n");
	for (const h of r.missingDirs) {
		process.stderr.write(`  missing directory: ${h.slice(0, 12)}…\n`);
	}
	for (const h of r.missingHtml) {
		process.stderr.write(`  missing index.html: ${h.slice(0, 12)}…\n`);
	}
	for (const h of r.missingJson) {
		process.stderr.write(`  missing receipt.json: ${h.slice(0, 12)}…\n`);
	}
	for (const h of r.duplicateHashes) {
		process.stderr.write(`  duplicate link: ${h.slice(0, 12)}…\n`);
	}
	process.exit(1);
}

if (import.meta.main) {
	if (!existsSync(RECEIPTS_DIR)) {
		// No receipts directory at all → nothing to check (e.g. fresh
		// checkout). The docs workflow has its own "fail if missing"
		// guard for the publish path; this script stays advisory here.
		process.stdout.write("Receipts directory absent — nothing to check.\n");
		process.exit(0);
	}
	if (!existsSync(INDEX_PATH)) {
		process.stderr.write(
			`Receipts directory exists but ${INDEX_PATH} is missing.\n`,
		);
		process.exit(1);
	}
	const result = checkReceiptsIndex(INDEX_PATH, RECEIPTS_DIR);
	const html = readFileSync(INDEX_PATH, "utf-8");
	const total = [...html.matchAll(HASH_HREF)].length;
	reportAndExit(result, total);
}
