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

function loadReceipts(dir: string): RawReceipt[] {
	if (!existsSync(dir)) return [];
	const entries = readdirSync(dir, { withFileTypes: true });
	const out: RawReceipt[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const jsonPath = join(dir, entry.name, "receipt.json");
		if (!existsSync(jsonPath)) continue;
		try {
			out.push(JSON.parse(readFileSync(jsonPath, "utf-8")) as RawReceipt);
		} catch {
			// Skip malformed JSON — buildGallery would drop the entry anyway,
			// but failing the whole manifest because of one corrupt file
			// would block every docs build until the receipt is regenerated.
		}
	}
	return out;
}

function main(): void {
	const raw = loadReceipts(RECEIPTS_DIR);
	const cards = buildGallery(raw);
	writeFileSync(OUT_PATH, `${JSON.stringify(cards, null, 2)}\n`, "utf-8");
	process.stdout.write(
		`Generated receipts-manifest.json: ${cards.length} card(s) from ${raw.length} receipt(s).\n`,
	);
}

main();
