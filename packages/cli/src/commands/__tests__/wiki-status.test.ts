/**
 * Wave 4 — `maina wiki status` surfaces in-flight compile progress (G9).
 *
 * A parallel `wiki init --background` run writes
 * `.maina/wiki/.progress.json` with `{ startedAt, percent, etaSeconds,
 * stage }`. When `wiki status` sees a live entry it renders the current
 * percent and ETA before the dashboard.
 *
 * Tests cover:
 *   - No progress file → existing dashboard (unchanged).
 *   - Fresh progress file → formatted progress line.
 *   - Stale progress file (> 10 min old, percent < 100) → "stalled" line.
 *   - Completed progress file (percent === 100) → ignored, normal
 *     dashboard.
 *   - `wiki init --background` returns a stub result immediately and
 *     writes an initial progress file.
 */
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Mocks ───────────────────────────────────────────────────────────────────

mock.module("@clack/prompts", () => ({
	intro: () => {},
	outro: () => {},
	log: {
		info: () => {},
		error: () => {},
		warning: () => {},
		success: () => {},
		message: () => {},
		step: () => {},
	},
	spinner: () => ({
		start: () => {},
		stop: () => {},
	}),
}));

// Stub @mainahq/core to avoid running the real compiler.
mock.module("@mainahq/core", () => ({
	compileWiki: async () => ({
		ok: true,
		value: {
			articles: [],
			stats: {
				modules: 0,
				entities: 0,
				features: 0,
				decisions: 0,
				architecture: 0,
			},
			duration: 1,
		},
	}),
	loadWikiState: () => null,
	hashContent: () => "x",
}));

afterAll(() => {
	mock.restore();
});

const { wikiStatusAction, formatProgressLine } = await import("../wiki/status");
const { wikiInitAction } = await import("../wiki/init");

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-wiki-status-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function seedWikiDirs(root: string): void {
	const subdirs = [
		"modules",
		"entities",
		"features",
		"decisions",
		"architecture",
		"raw",
	];
	for (const subdir of subdirs) {
		mkdirSync(join(root, ".maina", "wiki", subdir), { recursive: true });
	}
}

function writeProgress(
	root: string,
	data: {
		startedAt: string;
		percent: number;
		etaSeconds?: number;
		stage?: string;
	},
): void {
	const path = join(root, ".maina", "wiki", ".progress.json");
	mkdirSync(join(root, ".maina", "wiki"), { recursive: true });
	writeFileSync(path, JSON.stringify(data), "utf-8");
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = makeTmpDir();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("wiki status — progress rendering (G9)", () => {
	test("no progress file → progress is null", async () => {
		seedWikiDirs(tmpDir);
		const result = await wikiStatusAction({ cwd: tmpDir });
		expect(result.progress).toBeNull();
	});

	test("fresh progress file → progress object surfaced", async () => {
		seedWikiDirs(tmpDir);
		const now = new Date().toISOString();
		writeProgress(tmpDir, {
			startedAt: now,
			percent: 42,
			etaSeconds: 18,
			stage: "extracting",
		});

		const result = await wikiStatusAction({ cwd: tmpDir });

		expect(result.progress).not.toBeNull();
		expect(result.progress?.percent).toBe(42);
		expect(result.progress?.etaSeconds).toBe(18);
		expect(result.progress?.stale).toBe(false);
	});

	test("percent === 100 is treated as idle (progress null)", async () => {
		seedWikiDirs(tmpDir);
		writeProgress(tmpDir, {
			startedAt: new Date().toISOString(),
			percent: 100,
		});
		const result = await wikiStatusAction({ cwd: tmpDir });
		expect(result.progress).toBeNull();
	});

	test("progress file older than 10 minutes is flagged stale", async () => {
		seedWikiDirs(tmpDir);
		const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
		writeProgress(tmpDir, {
			startedAt: longAgo,
			percent: 20,
			etaSeconds: 600,
		});
		// Staleness is now measured by the progress file's mtime (not
		// `startedAt`), so a long-running compile that keeps writing stays
		// fresh. Backdate the file's mtime past the 10-minute threshold.
		const progressPath = join(tmpDir, ".maina", "wiki", ".progress.json");
		const hourAgoMs = (Date.now() - 60 * 60 * 1000) / 1000;
		utimesSync(progressPath, hourAgoMs, hourAgoMs);

		const result = await wikiStatusAction({ cwd: tmpDir });

		expect(result.progress?.stale).toBe(true);
		expect(result.progress?.percent).toBe(20);
	});

	test("formatProgressLine renders percent + ETA", () => {
		const line = formatProgressLine({
			startedAt: new Date().toISOString(),
			percent: 42,
			etaSeconds: 18,
			stage: "extracting",
			stale: false,
		});
		expect(line).toContain("42%");
		expect(line).toContain("18s");
	});

	test("formatProgressLine renders stalled message when stale", () => {
		const line = formatProgressLine({
			startedAt: new Date().toISOString(),
			percent: 20,
			etaSeconds: 600,
			stage: "extracting",
			stale: true,
		});
		expect(line.toLowerCase()).toContain("stalled");
		expect(line).toContain("20%");
	});
});

describe("wiki init --background", () => {
	test("returns a stub result without blocking", async () => {
		mkdirSync(join(tmpDir, ".maina"), { recursive: true });
		const result = await wikiInitAction({
			cwd: tmpDir,
			background: true,
			// DI: replace the real spawn with a no-op so the test does not
			// actually fork a child process.
			_spawnBackground: () => ({ pid: 99999 }),
		});

		// Stub result is emitted immediately — no articles compiled yet.
		expect(result.articlesCreated).toBe(0);
		expect(result.duration).toBeGreaterThanOrEqual(0);
		// Progress file must be seeded with the starting state.
		const progressPath = join(tmpDir, ".maina", "wiki", ".progress.json");
		expect(existsSync(progressPath)).toBe(true);
		const progress = JSON.parse(readFileSync(progressPath, "utf-8")) as {
			percent: number;
			stage: string;
		};
		expect(progress.percent).toBe(0);
		expect(progress.stage).toBe("starting");
	});

	test("--background with --depth quick propagates the sample flag", async () => {
		mkdirSync(join(tmpDir, ".maina"), { recursive: true });
		let spawnArgs: string[] | null = null;
		await wikiInitAction({
			cwd: tmpDir,
			background: true,
			depth: "quick",
			_spawnBackground: (args: string[]) => {
				spawnArgs = args;
				return { pid: 99998 };
			},
		});
		expect(spawnArgs).not.toBeNull();
		const joined = (spawnArgs ?? []).join(" ");
		// The background child should be told it's the quick variant.
		expect(joined).toContain("--depth");
		expect(joined).toContain("quick");
	});
});
