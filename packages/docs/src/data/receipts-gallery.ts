/**
 * Build-time helpers for the homepage receipts gallery (Wave 3.2 #257).
 *
 * The Astro component reads the JSON files via `import.meta.glob`; this
 * module turns the raw shapes into the trimmed cards the UI renders.
 *
 * Pure functions only — kept out of the component so unit tests can
 * exercise the empty state, sort order, copy discipline (C2), and the
 * status-badge allow-list without spinning up a Vite/Astro environment.
 */

export interface RawReceipt {
	prTitle?: unknown;
	repo?: unknown;
	timestamp?: unknown;
	status?: unknown;
	hash?: unknown;
	walkthrough?: unknown;
	diff?: {
		files?: unknown;
		additions?: unknown;
		deletions?: unknown;
	};
	checks?: unknown[];
}

export type StatusBadge = "passed" | "failed" | "partial";

export interface GalleryCard {
	prTitle: string;
	repo: string;
	timestamp: string;
	status: StatusBadge;
	statusLabel: string;
	hash: string;
	hashShort: string;
	href: string;
	walkthrough: string;
	diffSummary: string;
	passed: number;
	total: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Build the receipt URL for a card. The Pages workflow stages
 * `.maina/receipts/<hash>/` under `/receipts/` on the docs site, so this
 * is the URL the gallery actually lands on. `linkBase` defaults to
 * `/receipts/` — pass `/r/` to point at the polymorphic resolver once it
 * ships (Wave 1.8).
 */
export function receiptHref(hash: string, linkBase = "/receipts/"): string {
	const trimmed = linkBase.endsWith("/") ? linkBase : `${linkBase}/`;
	return `${trimmed}${hash}/`;
}

/**
 * Coerce + validate a single raw receipt into a card. Returns null if any
 * required field is missing or shaped wrong — the gallery silently skips
 * these so a single malformed receipt doesn't take the whole homepage out.
 */
export function toGalleryCard(
	raw: RawReceipt,
	options: { linkBase?: string } = {},
): GalleryCard | null {
	const hash = typeof raw.hash === "string" ? raw.hash : null;
	if (!hash || !HEX64.test(hash)) return null;
	const prTitle = typeof raw.prTitle === "string" ? raw.prTitle : null;
	if (!prTitle) return null;
	const repo = typeof raw.repo === "string" ? raw.repo : null;
	if (!repo) return null;
	const timestamp = typeof raw.timestamp === "string" ? raw.timestamp : null;
	if (!timestamp || !isIsoTimestamp(timestamp)) return null;
	const status = normalizeStatus(raw.status);
	if (!status) return null;
	const walkthroughRaw =
		typeof raw.walkthrough === "string" ? raw.walkthrough : "";
	const walkthrough = trimWalkthrough(walkthroughRaw);

	const checks = Array.isArray(raw.checks) ? raw.checks : [];
	const passed = checks.filter(
		(c): c is { status?: unknown } =>
			typeof c === "object" &&
			c !== null &&
			(c as { status?: unknown }).status === "passed",
	).length;
	const total = checks.length;

	const files = numOrZero(raw.diff?.files);
	const additions = numOrZero(raw.diff?.additions);
	const deletions = numOrZero(raw.diff?.deletions);
	const diffSummary = `+${additions} / −${deletions} across ${files} file${files === 1 ? "" : "s"}`;

	return {
		prTitle,
		repo,
		timestamp,
		status,
		statusLabel: statusLabel(status, passed, total),
		hash,
		hashShort: hash.slice(0, 12),
		href: receiptHref(hash, options.linkBase),
		walkthrough,
		diffSummary,
		passed,
		total,
	};
}

/**
 * Build the gallery from raw receipts: parse, drop malformed entries,
 * sort newest first, slice to limit. `limit` defaults to 6 (the
 * homepage shows a strip, not a backlog).
 */
export function buildGallery(
	rawReceipts: RawReceipt[],
	options: { limit?: number; linkBase?: string } = {},
): GalleryCard[] {
	const limit = options.limit ?? 6;
	const cards = rawReceipts
		.map((r) => toGalleryCard(r, { linkBase: options.linkBase }))
		.filter((c): c is GalleryCard => c !== null);
	// Newest-first; equal timestamps fall back to hash for a deterministic
	// total order. Returning 0 on full equality keeps the JS sort contract.
	cards.sort((a, b) => {
		if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
		if (a.hash !== b.hash) return a.hash < b.hash ? -1 : 1;
		return 0;
	});
	return cards.slice(0, limit);
}

function normalizeStatus(raw: unknown): StatusBadge | null {
	return raw === "passed" || raw === "failed" || raw === "partial" ? raw : null;
}

const ISO_8601 =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(raw: string): boolean {
	if (!ISO_8601.test(raw)) return false;
	const t = Date.parse(raw);
	return Number.isFinite(t);
}

function statusLabel(
	status: StatusBadge,
	passed: number,
	total: number,
): string {
	// C2 copy discipline: never "0 findings" / "no issues found".
	if (total === 0) {
		if (status === "passed") return "verified";
		if (status === "partial") return "partial — see logs";
		return "failed — see logs";
	}
	if (status === "passed") return `passed ${passed} of ${total} checks`;
	if (status === "partial") return `partial — ${passed} of ${total} held`;
	return `failed — ${passed} of ${total} held`;
}

function trimWalkthrough(raw: string): string {
	const collapsed = raw.replace(/\s+/g, " ").trim();
	if (collapsed.length <= 220) return collapsed;
	return `${collapsed.slice(0, 217).replace(/\s+\S*$/, "")}…`;
}

function numOrZero(raw: unknown): number {
	return typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0;
}
