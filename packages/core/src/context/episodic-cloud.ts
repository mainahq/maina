/**
 * Team episodic entries from maina cloud, bounded and cached (#439).
 *
 * The episodic layer merges the team's cloud entries into the local ones.
 * That merge must never hold a context call hostage: the fetch gets one
 * attempt under a hard deadline, and its outcome (entries or failure) is
 * cached under `mainaDir/cache/` so the next call reads the file instead of
 * waiting on the network again.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CloudEpisodicEntry } from "../cloud/types";
import type { Result } from "../db/index";

/** Hard ceiling on one cloud fetch. */
export const DEFAULT_CLOUD_EPISODIC_TIMEOUT_MS = 1_500;

/** How long fetched entries are reused before the cloud is asked again. */
const HIT_TTL_MS = 10 * 60_000;
/** How long a failed or timed-out fetch keeps the cloud from being retried. */
const MISS_TTL_MS = 2 * 60_000;

type CacheRecord = Readonly<{
	key: string;
	fetchedAt: number;
	ok: boolean;
	entries: readonly CloudEpisodicEntry[];
}>;

type CloudEpisodicRequest = Readonly<{
	mainaDir: string;
	/** Identifies the source: cloud URL, repository slug and account. */
	key: string;
	/** One attempt at the cloud; its own timeout is a second line of defence. */
	fetch: () => Promise<Result<CloudEpisodicEntry[], string>>;
	timeoutMs: number;
	now: () => number;
}>;

const cachePath = (mainaDir: string): string =>
	join(mainaDir, "cache", "episodic-cloud.json");

function readCache(mainaDir: string): CacheRecord | null {
	try {
		const path = cachePath(mainaDir);
		if (!existsSync(path)) return null;
		const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheRecord;
		if (
			typeof parsed.key !== "string" ||
			typeof parsed.fetchedAt !== "number" ||
			typeof parsed.ok !== "boolean" ||
			!Array.isArray(parsed.entries)
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

function writeCache(mainaDir: string, record: CacheRecord): void {
	try {
		const path = cachePath(mainaDir);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(record), "utf8");
	} catch {
		// A cache that cannot be written only costs the next call a fetch.
	}
}

const isFresh = (record: CacheRecord, key: string, now: number): boolean => {
	if (record.key !== key) return false;
	const age = now - record.fetchedAt;
	return age >= 0 && age < (record.ok ? HIT_TTL_MS : MISS_TTL_MS);
};

/** Settles with the fetch result, or with an error once the deadline passes. */
async function withDeadline(
	request: CloudEpisodicRequest,
): Promise<Result<CloudEpisodicEntry[], string>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<Result<CloudEpisodicEntry[], string>>(
		(resolve) => {
			timer = setTimeout(
				() => resolve({ ok: false, error: "cloud episodic fetch timed out" }),
				request.timeoutMs,
			);
		},
	);
	try {
		return await Promise.race([
			request.fetch().catch(
				(e: unknown): Result<CloudEpisodicEntry[], string> => ({
					ok: false,
					error: e instanceof Error ? e.message : String(e),
				}),
			),
			deadline,
		]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The team's cloud episodic entries: from the cache while it is fresh,
 * otherwise from one fetch bounded by `timeoutMs`. A failure yields no
 * entries and is cached too, so an unreachable cloud costs one timeout per
 * miss window rather than one per call. Never throws.
 */
export async function loadCloudEpisodicEntries(
	request: CloudEpisodicRequest,
): Promise<readonly CloudEpisodicEntry[]> {
	const cached = readCache(request.mainaDir);
	if (cached && isFresh(cached, request.key, request.now())) {
		return cached.entries;
	}

	const result = await withDeadline(request);
	const entries = result.ok ? result.value : [];
	writeCache(request.mainaDir, {
		key: request.key,
		fetchedAt: request.now(),
		ok: result.ok,
		entries,
	});
	return entries;
}
