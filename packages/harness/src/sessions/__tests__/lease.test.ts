import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionsDir, withWorktreeLock } from "../lease";
import {
	type ProcessState,
	type ProcessTable,
	systemProcesses,
} from "../processes";

const STALE = { pid: 999_001, start: "crashed" };
const OTHER = { pid: 999_002, start: "alive" };

function commonDir(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "maina-lease-")));
	mkdirSync(sessionsDir(dir), { recursive: true });
	return dir;
}

const lockFile = (dir: string): string =>
	join(sessionsDir(dir), "worktrees.lock");

/** This process is real; STALE has crashed; OTHER runs. */
function table(onProbeStale: () => void = () => undefined): ProcessTable {
	return {
		...systemProcesses,
		probe: (pid): ProcessState => {
			if (pid === STALE.pid) {
				onProbeStale();
				return { state: "gone" };
			}
			if (pid === OTHER.pid) return { state: "running", start: OTHER.start };
			return systemProcesses.probe(pid);
		},
	};
}

const ok = async () => ({ ok: true as const, value: undefined });

describe("withWorktreeLock", () => {
	test("breaks a lock whose holder crashed", async () => {
		const dir = commonDir();
		writeFileSync(lockFile(dir), JSON.stringify(STALE));
		let ran = false;
		const held = await withWorktreeLock(dir, table(), async () => {
			ran = true;
			return ok();
		});
		expect(held.ok).toBe(true);
		expect(ran).toBe(true);
		expect(existsSync(lockFile(dir))).toBe(false);
	});

	test("never deletes a lock another process took while this one judged it stale", async () => {
		// Two waiters see the same crashed holder; the first breaks the lock
		// and takes it. The second must not then delete the first's lock.
		const dir = commonDir();
		writeFileSync(lockFile(dir), JSON.stringify(STALE));
		let otherReleased = false;
		const processes = table(() => {
			if (otherReleased) return;
			rmSync(lockFile(dir), { force: true });
			writeFileSync(lockFile(dir), JSON.stringify({ ...OTHER, nonce: "a" }));
			setTimeout(() => {
				rmSync(lockFile(dir), { force: true });
				otherReleased = true;
			}, 150);
		});
		let ranWhileOtherHeld: boolean | undefined;
		const held = await withWorktreeLock(dir, processes, async () => {
			ranWhileOtherHeld = !otherReleased;
			return ok();
		});
		expect(held.ok).toBe(true);
		expect(ranWhileOtherHeld).toBe(false);
	});

	test("releasing never deletes a lock that is no longer this holder's", async () => {
		const dir = commonDir();
		const foreign = JSON.stringify({ ...OTHER, nonce: "b" });
		const held = await withWorktreeLock(dir, table(), async () => {
			// Someone broke this lock (wrongly) and took it over.
			rmSync(lockFile(dir), { force: true });
			writeFileSync(lockFile(dir), foreign);
			return ok();
		});
		expect(held.ok).toBe(true);
		expect(readFileSync(lockFile(dir), "utf8")).toBe(foreign);
	});

	test("the lock file never exists without its holder written in it", async () => {
		const dir = commonDir();
		let seen = "";
		await withWorktreeLock(dir, table(), async () => {
			seen = readFileSync(lockFile(dir), "utf8");
			return ok();
		});
		expect(JSON.parse(seen)).toMatchObject({ pid: process.pid });
	});
});
