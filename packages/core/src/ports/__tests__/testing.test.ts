import { describe, expect, test } from "bun:test";
import type { CorePorts } from "../index";
import {
	createFakeEnv,
	createFakeGit,
	createFakeModel,
	createFakePorts,
	createFixedClock,
	createMemoryDb,
	createMemoryFs,
	createMemoryLogger,
} from "../testing";

describe("createMemoryFs", () => {
	test("reads seeded files and reports missing ones as not_found", async () => {
		const fs = createMemoryFs({ "/repo/a.txt": "hello" });
		expect(await fs.readFile("/repo/a.txt")).toEqual({
			ok: true,
			value: "hello",
		});
		expect(await fs.readFile("/repo/missing.txt")).toEqual({
			ok: false,
			error: { kind: "not_found", path: "/repo/missing.txt" },
		});
	});

	test("writes, lists and removes files without touching disk", async () => {
		const fs = createMemoryFs();
		expect(await fs.writeFile("/r/src/x.ts", "x")).toEqual({
			ok: true,
			value: undefined,
		});
		await fs.writeFile("/r/src/y.ts", "y");
		await fs.writeFile("/r/src/nested/z.ts", "z");
		expect(await fs.exists("/r/src")).toBe(true);
		expect(await fs.exists("/r/src/x.ts")).toBe(true);
		expect(await fs.readDir("/r/src")).toEqual({
			ok: true,
			value: ["nested", "x.ts", "y.ts"],
		});
		expect(await fs.remove("/r/src/x.ts")).toEqual({
			ok: true,
			value: undefined,
		});
		expect(await fs.exists("/r/src/x.ts")).toBe(false);
	});

	test("normalises paths so ./ and .. resolve to the same key", async () => {
		const fs = createMemoryFs({ "/r/a/b.txt": "b" });
		expect(await fs.readFile("/r/a/./c/../b.txt")).toEqual({
			ok: true,
			value: "b",
		});
	});

	test("treats backslash and slash separators alike on every platform", async () => {
		const fs = createMemoryFs({ "C:\\repo\\src\\a.ts": "a" });
		expect(await fs.readFile("C:/repo/src/a.ts")).toEqual({
			ok: true,
			value: "a",
		});
		expect(await fs.readDir("C:\\repo")).toEqual({ ok: true, value: ["src"] });
	});

	test("readDir on a missing directory is not_found", async () => {
		const fs = createMemoryFs();
		expect(await fs.readDir("/nope")).toEqual({
			ok: false,
			error: { kind: "not_found", path: "/nope" },
		});
	});
});

describe("createFakeGit", () => {
	test("returns scripted stdout and records calls", async () => {
		const git = createFakeGit({ "rev-parse --abbrev-ref HEAD": "main\n" });
		expect(
			await git.run("/repo", ["rev-parse", "--abbrev-ref", "HEAD"]),
		).toEqual({ ok: true, value: "main\n" });
		expect(git.calls()).toEqual([
			{ root: "/repo", args: ["rev-parse", "--abbrev-ref", "HEAD"] },
		]);
	});

	test("unscripted commands fail with a typed error instead of throwing", async () => {
		const git = createFakeGit();
		const result = await git.run("/repo", ["status"]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("failed");
	});

	test("only own scripted keys match, not Object.prototype members", async () => {
		const git = createFakeGit();
		const result = await git.run("/repo", ["toString"]);
		expect(result.ok).toBe(false);
	});
});

describe("createMemoryDb", () => {
	test("runs statements and queries rows in memory", () => {
		const db = createMemoryDb();
		expect(db.run("CREATE TABLE t (id INTEGER, name TEXT)")).toEqual({
			ok: true,
			value: undefined,
		});
		db.run("INSERT INTO t VALUES (?, ?)", [1, "a"]);
		expect(db.all("SELECT id, name FROM t WHERE id = ?", [1])).toEqual({
			ok: true,
			value: [{ id: 1, name: "a" }],
		});
	});

	test("invalid SQL is a typed error", () => {
		const result = createMemoryDb().all("SELECT * FROM missing");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("query_failed");
	});
});

describe("createFixedClock", () => {
	test("returns the fixed time and advances on demand", () => {
		const clock = createFixedClock(1_000);
		expect(clock.now()).toBe(1_000);
		clock.advance(250);
		expect(clock.now()).toBe(1_250);
	});
});

describe("createMemoryLogger", () => {
	test("captures entries by level", () => {
		const logger = createMemoryLogger();
		logger.info("hello", { a: 1 });
		logger.error("bad");
		expect(logger.entries()).toEqual([
			{ level: "info", message: "hello", fields: { a: 1 } },
			{ level: "error", message: "bad", fields: undefined },
		]);
	});
});

describe("createFakeModel", () => {
	test("answers with the responder and records requests", async () => {
		const model = createFakeModel((req) => `echo:${req.prompt}`);
		const result = await model.generate({
			tier: "mechanical",
			system: "s",
			prompt: "p",
		});
		expect(result).toEqual({
			ok: true,
			value: { text: "echo:p", model: "fake" },
		});
		expect(model.requests()).toHaveLength(1);
	});

	test("a throwing responder becomes a failed Result, not a rejection", async () => {
		const model = createFakeModel(() => {
			throw new Error("boom");
		});
		const result = await model.generate({
			tier: "standard",
			system: "",
			prompt: "x",
		});
		expect(result).toEqual({
			ok: false,
			error: { kind: "failed", message: "boom" },
		});
	});

	test("without a responder the model is unavailable", async () => {
		const result = await createFakeModel().generate({
			tier: "standard",
			system: "",
			prompt: "x",
		});
		expect(result).toEqual({
			ok: false,
			error: { kind: "unavailable", message: "fake model has no responder" },
		});
	});
});

describe("createFakeEnv", () => {
	test("reads only the provided variables", () => {
		const env = createFakeEnv({ MAINA_TOKEN: "t" });
		expect(env.get("MAINA_TOKEN")).toBe("t");
		expect(env.get("HOME")).toBeUndefined();
	});
});

describe("createFakePorts", () => {
	test("builds a complete CorePorts bundle with overrides", async () => {
		const env = createFakeEnv({ A: "1" });
		const ports: CorePorts = createFakePorts({ env });
		expect(ports.env).toBe(env);
		expect(Object.keys(ports).sort()).toEqual([
			"clock",
			"db",
			"env",
			"fs",
			"git",
			"logger",
			"model",
		]);
		expect(await ports.fs.exists("/anything")).toBe(false);
	});
});
