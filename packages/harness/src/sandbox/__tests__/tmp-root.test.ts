import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { testTmpDir } from "../../__tests__/test-tmp";
import {
	makeTmpRoot,
	removeTmpRoot,
	sweepStaleTmpRoots,
	TMP_MARKER,
} from "../tmp-root";

const HOUR = 60 * 60 * 1000;

/** A marked dir under `parent` whose marker is `ageMs` old and names `pid`. */
function marked(parent: string, name: string, ageMs: number, pid = 999_999) {
	const dir = join(parent, name);
	mkdirSync(dir);
	writeFileSync(join(dir, TMP_MARKER), `${pid}\n`);
	writeFileSync(join(dir, "payload"), "x");
	const when = (Date.now() - ageMs) / 1000;
	utimesSync(join(dir, TMP_MARKER), when, when);
	return dir;
}

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) removeTmpRoot(dir);
});

describe("makeTmpRoot", () => {
	test("a private dir under the parent that carries the owner's marker", () => {
		const parent = testTmpDir("maina-tmproot-");
		const root = makeTmpRoot("maina-x-", parent);
		if (!root.ok) throw new Error(root.error.message);
		made.push(root.value);
		expect(root.value.startsWith(join(parent, "maina-x-"))).toBe(true);
		expect(statSync(root.value).mode & 0o777).toBe(0o700);
		expect(readFileSync(join(root.value, TMP_MARKER), "utf8").trim()).toBe(
			String(process.pid),
		);
	});

	test("a parent it cannot write into is an error, not a throw", () => {
		const root = makeTmpRoot("maina-x-", "/nonexistent/maina-632");
		expect(root.ok).toBe(false);
	});
});

describe("removeTmpRoot", () => {
	test("removes a marked dir and everything in it", () => {
		const parent = testTmpDir("maina-tmproot-");
		const root = makeTmpRoot("maina-x-", parent);
		if (!root.ok) throw new Error(root.error.message);
		mkdirSync(join(root.value, "srt-ca-abc"));
		writeFileSync(join(root.value, "srt-ca-abc", "ca.key"), "k");
		removeTmpRoot(root.value);
		expect(existsSync(root.value)).toBe(false);
	});

	test("leaves a dir without the marker alone", () => {
		const parent = testTmpDir("maina-tmproot-");
		const dir = join(parent, "someone-elses");
		mkdirSync(dir);
		removeTmpRoot(dir);
		expect(existsSync(dir)).toBe(true);
	});
});

describe("sweepStaleTmpRoots: what a crashed run left behind", () => {
	test("removes stale marked dirs whose owner is gone, and nothing else", () => {
		const parent = testTmpDir("maina-sweep-");
		const stale = marked(parent, "maina-sandbox-old", 3 * HOUR);
		const fresh = marked(parent, "maina-sandbox-new", 60_000);
		const running = marked(parent, "maina-sandbox-live", 3 * HOUR, 4242);
		const otherPrefix = marked(parent, "someone-old", 3 * HOUR);
		const unmarked = join(parent, "maina-sandbox-unmarked");
		mkdirSync(unmarked);
		const removed = sweepStaleTmpRoots(["maina-sandbox-"], {
			parent,
			maxAgeMs: HOUR,
			alive: (pid) => pid === 4242,
		});
		expect(removed).toEqual([stale]);
		expect(existsSync(stale)).toBe(false);
		for (const kept of [fresh, running, otherPrefix, unmarked]) {
			expect(existsSync(kept)).toBe(true);
		}
	});

	test("a parent that does not exist sweeps nothing", () => {
		expect(
			sweepStaleTmpRoots(["maina-sandbox-"], {
				parent: "/nonexistent/maina-632",
			}),
		).toEqual([]);
	});
});

describe("exit hook: roots nobody removed", () => {
	test("are gone once the owning process exits", async () => {
		const parent = testTmpDir("maina-exit-");
		const script = `
			import { makeTmpRoot } from ${JSON.stringify(join(import.meta.dir, "..", "tmp-root.ts"))};
			const root = makeTmpRoot("maina-sandbox-", ${JSON.stringify(parent)});
			if (!root.ok) process.exit(2);
			await Bun.write(root.value + "/srt-ca-leak/ca.key", "k");
			process.stdout.write(root.value);
		`;
		const child = Bun.spawn(["bun", "-e", script], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [out, code] = await Promise.all([
			new Response(child.stdout).text(),
			child.exited,
		]);
		expect(code).toBe(0);
		expect(out.startsWith(join(parent, "maina-sandbox-"))).toBe(true);
		expect(readdirSync(parent)).toEqual([]);
	});
});
