import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "../../../policy/defaults";
import type { FsPort } from "../../../ports/fs";
import { createMemoryFs } from "../../../ports/testing";
import {
	LOG_SALT_GITIGNORE,
	LOG_SALT_PATH,
	loadLogSalt,
	logPrivacy,
} from "../salt";
import { unwrap } from "./fixtures";

const ROOT = "/repo";
const SALT_FILE = `${ROOT}/${LOG_SALT_PATH}`;
const IGNORE_FILE = `${ROOT}/${LOG_SALT_GITIGNORE}`;

function counter(): () => string {
	let n = 0;
	return () => {
		n += 1;
		return n.toString(16).padStart(64, "0");
	};
}

describe("loadLogSalt", () => {
	test("creates a random salt under .maina on first use and keeps it", async () => {
		const fs = createMemoryFs();
		const first = unwrap(await loadLogSalt({ fs }, ROOT));
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(unwrap(await fs.readFile(SALT_FILE)).trim()).toBe(first);
		expect(unwrap(await loadLogSalt({ fs }, ROOT))).toBe(first);
	});

	test("lives under .maina and is gitignored so it is never committed", async () => {
		expect(LOG_SALT_PATH.startsWith(".maina/")).toBe(true);
		const fs = createMemoryFs();
		unwrap(await loadLogSalt({ fs }, ROOT));
		expect(unwrap(await fs.readFile(IGNORE_FILE))).toBe("*\n");
	});

	test("each repo gets its own salt", async () => {
		const fs = createMemoryFs();
		const a = unwrap(await loadLogSalt({ fs }, "/a"));
		const b = unwrap(await loadLogSalt({ fs }, "/b"));
		expect(a).not.toBe(b);
	});

	test("uses the injected generator and reads back what is on disk", async () => {
		const fs = createMemoryFs();
		const next = counter();
		expect(unwrap(await loadLogSalt({ fs }, ROOT, next))).toBe(
			`${"0".repeat(63)}1`,
		);
		expect(unwrap(await loadLogSalt({ fs }, ROOT, next))).toBe(
			`${"0".repeat(63)}1`,
		);
	});

	test("a malformed salt file is an error, never silently replaced", async () => {
		const fs = createMemoryFs({ [SALT_FILE]: "not a salt" });
		const result = await loadLogSalt({ fs }, ROOT);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toEqual(
			expect.objectContaining({ kind: "invalid_salt", path: SALT_FILE }),
		);
		expect(unwrap(await fs.readFile(SALT_FILE))).toBe("not a salt");
	});

	test("an unreadable salt file is returned as an error", async () => {
		const base = createMemoryFs();
		const fs: FsPort = {
			...base,
			readFile: async (path) => ({
				ok: false,
				error: { kind: "io", path, message: "EACCES" },
			}),
		};
		const result = await loadLogSalt({ fs }, ROOT);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("io");
	});
});

describe("logPrivacy", () => {
	test("hashes paths by default and keys the hashes with the salt", () => {
		const salt = "a".repeat(64);
		expect(logPrivacy(DEFAULT_POLICY, salt)).toEqual({
			rawOptions: false,
			salt,
		});
	});

	test("policy.log.paths = plain keeps free-form options in the clear", () => {
		const policy = { ...DEFAULT_POLICY, log: { paths: "plain" as const } };
		expect(logPrivacy(policy, "b".repeat(64)).rawOptions).toBe(true);
	});
});
