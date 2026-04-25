/**
 * Generate receipts-manifest.json from `.maina/receipts/<hash>/receipt.json`
 * (Wave 3.2 follow-up #274).
 *
 * Run at build time via the docs `prebuild` script. Replaces the eager
 * `import.meta.glob` in `ReceiptGallery.astro` so the docs build no
 * longer parses every receipt JSON just to render the newest 6 — once
 * the backfill grows past ~100 receipts the eager path dominates the
 * build budget.
 *
 * Output: `packages/docs/src/data/receipts-manifest.json` containing the
 * trimmed `GalleryCard[]` the component renders directly. The component
 * is now a pure consumer; all the receipt-shape parsing happens here.
 *
 * Per repo convention (`Result<T, E>`, never throw), every I/O boundary
 * returns a Result; `main()` aggregates them and exits non-zero on any
 * failure rather than letting an exception bubble.
 *
 * Run manually:
 *     bun packages/docs/scripts/generate-receipts-manifest.ts
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGallery, type RawReceipt } from "../src/data/receipts-gallery";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");
const RECEIPTS_DIR = join(ROOT, ".maina", "receipts");
const OUT_PATH = join(ROOT, "packages/docs/src/data/receipts-manifest.json");

type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

function readReceipt(jsonPath: string): Result<RawReceipt> {
	let raw: string;
	try {
		raw = readFileSync(jsonPath, "utf-8");
	} catch (e) {
		return {
			ok: false,
			error: `read failed: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
	try {
		return { ok: true, value: JSON.parse(raw) as RawReceipt };
	} catch (e) {
		return {
			ok: false,
			error: `parse failed: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

interface LoadOutcome {
	receipts: RawReceipt[];
	skipped: Array<{ jsonPath: string; reason: string }>;
}

function loadReceipts(dir: string): LoadOutcome {
	if (!existsSync(dir)) return { receipts: [], skipped: [] };
	const out: LoadOutcome = { receipts: [], skipped: [] };
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const jsonPath = join(dir, entry.name, "receipt.json");
		if (!existsSync(jsonPath)) continue;
		const result = readReceipt(jsonPath);
		if (result.ok) {
			out.receipts.push(result.value);
		} else {
			// Skip individual corrupt receipts so one bad file doesn't block
			// every docs build, but log to stderr so the failure isn't
			// silent — `buildGallery` only handles malformed *shapes*, not
			// the read/parse failures that happen earlier in the pipeline.
			out.skipped.push({ jsonPath, reason: result.error });
		}
	}
	return out;
}

function writeManifest(path: string, content: string): Result<void> {
	try {
		writeFileSync(path, content, "utf-8");
		return { ok: true, value: undefined };
	} catch (e) {
		return {
			ok: false,
			error: `write failed: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

function main(): Result<void> {
	const { receipts, skipped } = loadReceipts(RECEIPTS_DIR);
	for (const s of skipped) {
		process.stderr.write(`warn: skipping ${s.jsonPath} — ${s.reason}\n`);
	}
	const cards = buildGallery(receipts);
	const written = writeManifest(
		OUT_PATH,
		`${JSON.stringify(cards, null, 2)}\n`,
	);
	if (!written.ok) return written;
	process.stdout.write(
		`Generated receipts-manifest.json: ${cards.length} card(s) from ${receipts.length} receipt(s).\n`,
	);
	return { ok: true, value: undefined };
}

const result = main();
if (!result.ok) {
	process.stderr.write(
		`receipts-manifest generation failed: ${result.error}\n`,
	);
	process.exit(1);
}
