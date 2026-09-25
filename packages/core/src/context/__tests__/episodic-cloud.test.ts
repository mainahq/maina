import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloudEpisodicEntry } from "../../cloud/types";
import type { Result } from "../../db/index";
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

const dirs: string[] = [];
const tempMainaDir = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "maina-episodic-cloud-"));
	dirs.push(dir);
	return dir;
};

afterEach(() => {
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

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
			mainaDir: tempMainaDir(),
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
			mainaDir: tempMainaDir(),
			key: "k",
			fetch: () => Promise.reject(new Error("boom")),
			timeoutMs: 50,
			now: () => 0,
		});
		expect(entries).toEqual([]);
	});

	test("fetched entries are reused for ten minutes, then refetched", async () => {
		const mainaDir = tempMainaDir();
		const source = counting(answers);
		let now = 1_000;
		const load = () =>
			loadCloudEpisodicEntries({
				mainaDir,
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
		const mainaDir = tempMainaDir();
		const source = counting(fails);
		let now = 1_000;
		const load = () =>
			loadCloudEpisodicEntries({
				mainaDir,
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
		const mainaDir = tempMainaDir();
		const source = counting(answers);
		const load = (key: string) =>
			loadCloudEpisodicEntries({
				mainaDir,
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
		const mainaDir = tempMainaDir();
		mkdirSync(join(mainaDir, "cache"), { recursive: true });
		writeFileSync(join(mainaDir, "cache", "episodic-cloud.json"), "{not json");
		const source = counting(answers);
		const entries = await loadCloudEpisodicEntries({
			mainaDir,
			key: "k",
			fetch: source.fetch,
			timeoutMs: 50,
			now: () => 1_000,
		});
		expect(entries).toEqual([entry]);
		expect(source.calls()).toBe(1);
	});
});
