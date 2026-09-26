import { describe, expect, test } from "bun:test";
import type { CloudEpisodicEntry } from "../../cloud/types";
import type { Result } from "../../db/index";
import type { FsPort } from "../../ports/fs";
import { createMemoryFs } from "../../ports/testing";
import { loadCloudEpisodicEntries } from "../episodic-cloud";

const entry: CloudEpisodicEntry = {
	id: "c1",
	memberId: "m1",
	repo: "acme/app",
	entryType: "review",
	title: "t",
	summary: "s",
	relevanceScore: 1,
	decayFactor: 1,
	createdAt: "2026-09-01T00:00:00.000Z",
	accessedAt: "2026-09-01T00:00:00.000Z",
};

const MAINA_DIR = "/repo/.maina";
const CACHE_FILE = `${MAINA_DIR}/cache/episodic-cloud.json`;

type Fetch = () => Promise<Result<CloudEpisodicEntry[], string>>;

const counting = (impl: Fetch): { fetch: Fetch; calls: () => number } => {
	let calls = 0;
	return {
		fetch: () => {
			calls++;
			return impl();
		},
		calls: () => calls,
	};
};

const answers: Fetch = async () => ({ ok: true, value: [entry] });
const fails: Fetch = async () => ({ ok: false, error: "HTTP 500" });
const hangs: Fetch = () => new Promise(() => undefined);

describe("loadCloudEpisodicEntries", () => {
	test("a fetch that never settles resolves empty at the deadline", async () => {
		const started = performance.now();
		const entries = await loadCloudEpisodicEntries({
			mainaDir: MAINA_DIR,
			fs: createMemoryFs(),
			key: "k",
			fetch: hangs,
			timeoutMs: 50,
			now: () => 0,
		});
		expect(entries).toEqual([]);
		expect(performance.now() - started).toBeLessThan(1_000);
	});

	test("a rejected fetch resolves empty instead of throwing", async () => {
		const entries = await loadCloudEpisodicEntries({
			mainaDir: MAINA_DIR,
			fs: createMemoryFs(),
			key: "k",
			fetch: () => Promise.reject(new Error("boom")),
			timeoutMs: 50,
			now: () => 0,
		});
		expect(entries).toEqual([]);
	});

	test("fetched entries are reused for ten minutes, then refetched", async () => {
		const fs = createMemoryFs();
		const source = counting(answers);
		let now = 1_000;
		const load = () =>
			loadCloudEpisodicEntries({
				mainaDir: MAINA_DIR,
				fs,
				key: "k",
				fetch: source.fetch,
				timeoutMs: 50,
				now: () => now,
			});

		expect(await load()).toEqual([entry]);
		now += 9 * 60_000;
		expect(await load()).toEqual([entry]);
		expect(source.calls()).toBe(1);

		now += 2 * 60_000;
		await load();
		expect(source.calls()).toBe(2);
	});

	test("a failure is cached for two minutes, then retried", async () => {
		const fs = createMemoryFs();
		const source = counting(fails);
		let now = 1_000;
		const load = () =>
			loadCloudEpisodicEntries({
				mainaDir: MAINA_DIR,
				fs,
				key: "k",
				fetch: source.fetch,
				timeoutMs: 50,
				now: () => now,
			});

		expect(await load()).toEqual([]);
		now += 60_000;
		expect(await load()).toEqual([]);
		expect(source.calls()).toBe(1);

		now += 2 * 60_000;
		await load();
		expect(source.calls()).toBe(2);
	});

	test("a different key (cloud URL or repo) bypasses the cache", async () => {
		const fs = createMemoryFs();
		const source = counting(answers);
		const load = (key: string) =>
			loadCloudEpisodicEntries({
				mainaDir: MAINA_DIR,
				fs,
				key,
				fetch: source.fetch,
				timeoutMs: 50,
				now: () => 1_000,
			});

		await load("https://a|acme/app");
		await load("https://a|acme/other");
		expect(source.calls()).toBe(2);
	});

	test("a corrupt cache file is ignored", async () => {
		const fs = createMemoryFs({ [CACHE_FILE]: "{not json" });
		const source = counting(answers);
		const entries = await loadCloudEpisodicEntries({
			mainaDir: MAINA_DIR,
			fs,
			key: "k",
			fetch: source.fetch,
			timeoutMs: 50,
			now: () => 1_000,
		});
		expect(entries).toEqual([entry]);
		expect(source.calls()).toBe(1);
	});

	test("a cached record with a malformed entry is ignored", async () => {
		const fs = createMemoryFs({
			[CACHE_FILE]: JSON.stringify({
				key: "k",
				fetchedAt: 1_000,
				ok: true,
				entries: [{ id: 42 }],
			}),
		});
		const source = counting(answers);
		const entries = await loadCloudEpisodicEntries({
			mainaDir: MAINA_DIR,
			fs,
			key: "k",
			fetch: source.fetch,
			timeoutMs: 50,
			now: () => 1_000,
		});
		expect(entries).toEqual([entry]);
		expect(source.calls()).toBe(1);
	});

	test("a cached entry without a numeric decayFactor is ignored", async () => {
		// The merge computes relevance as relevanceScore * decayFactor; a
		// missing factor would turn it into NaN and break the relevance sort.
		const { decayFactor: _dropped, ...withoutDecay } = entry;
		const fs = createMemoryFs({
			[CACHE_FILE]: JSON.stringify({
				key: "k",
				fetchedAt: 1_000,
				ok: true,
				entries: [withoutDecay],
			}),
		});
		const source = counting(answers);
		const entries = await loadCloudEpisodicEntries({
			mainaDir: MAINA_DIR,
			fs,
			key: "k",
			fetch: source.fetch,
			timeoutMs: 50,
			now: () => 1_000,
		});
		expect(entries).toEqual([entry]);
		expect(source.calls()).toBe(1);
	});

	test("the cache is read and written only through the injected FsPort", async () => {
		const fs = createMemoryFs();
		const load = (fetch: Fetch) =>
			loadCloudEpisodicEntries({
				mainaDir: MAINA_DIR,
				fs,
				key: "k",
				fetch,
				timeoutMs: 50,
				now: () => 1_000,
			});

		await load(answers);
		const written = await fs.readFile(CACHE_FILE);
		expect(written.ok).toBe(true);

		const source = counting(fails);
		expect(await load(source.fetch)).toEqual([entry]);
		expect(source.calls()).toBe(0);
	});

	test("a cache write failure still returns the fetched entries", async () => {
		const failingFs: FsPort = {
			...createMemoryFs(),
			writeFile: async (path) => ({
				ok: false,
				error: { kind: "io", path, message: "read-only" },
			}),
		};
		const entries = await loadCloudEpisodicEntries({
			mainaDir: MAINA_DIR,
			fs: failingFs,
			key: "k",
			fetch: answers,
			timeoutMs: 50,
			now: () => 1_000,
		});
		expect(entries).toEqual([entry]);
	});
});
