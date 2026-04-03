import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type InitActionDeps, initAction } from "../init";

function makeTmpDir(): string {
	const dir = join(
		tmpdir(),
		`maina-init-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeGitRepo(dir: string): void {
	mkdirSync(join(dir, ".git"), { recursive: true });
}

function makeDeps(overrides?: Partial<InitActionDeps>): InitActionDeps {
	return {
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
		...overrides,
	};
}

describe("maina init CLI", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("successful init shows created files", async () => {
		makeGitRepo(tmpDir);
		const messages: string[] = [];
		const deps = makeDeps({
			log: {
				info: (msg: string) => messages.push(`info:${msg}`),
				error: (msg: string) => messages.push(`error:${msg}`),
				warning: (msg: string) => messages.push(`warning:${msg}`),
				success: (msg: string) => messages.push(`success:${msg}`),
				message: (msg: string) => messages.push(`message:${msg}`),
				step: (msg: string) => messages.push(`step:${msg}`),
			},
		});

		const result = await initAction({ cwd: tmpDir }, deps);

		expect(result.ok).toBe(true);
		// Should have logged created files
		const successMessages = messages.filter((m) => m.startsWith("success:"));
		expect(successMessages.length).toBeGreaterThan(0);
		// .maina directory should exist
		expect(existsSync(join(tmpDir, ".maina"))).toBe(true);
	});

	test("already initialized shows skipped files", async () => {
		makeGitRepo(tmpDir);
		const mainaDir = join(tmpDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });
		writeFileSync(join(mainaDir, "constitution.md"), "existing\n");
		writeFileSync(join(tmpDir, "AGENTS.md"), "existing\n");

		const messages: string[] = [];
		const deps = makeDeps({
			log: {
				info: (msg: string) => messages.push(`info:${msg}`),
				error: (msg: string) => messages.push(`error:${msg}`),
				warning: (msg: string) => messages.push(`warning:${msg}`),
				success: (msg: string) => messages.push(`success:${msg}`),
				message: (msg: string) => messages.push(`message:${msg}`),
				step: (msg: string) => messages.push(`step:${msg}`),
			},
		});

		const result = await initAction({ cwd: tmpDir }, deps);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.skipped.length).toBeGreaterThan(0);
		}
		// Should mention skipped files
		const warningMessages = messages.filter((m) => m.startsWith("warning:"));
		expect(warningMessages.length).toBeGreaterThan(0);
	});

	test("--force flag passed through", async () => {
		makeGitRepo(tmpDir);
		const mainaDir = join(tmpDir, ".maina");
		mkdirSync(mainaDir, { recursive: true });
		writeFileSync(join(mainaDir, "constitution.md"), "old content\n");

		const deps = makeDeps();
		const result = await initAction({ cwd: tmpDir, force: true }, deps);

		expect(result.ok).toBe(true);
		if (result.ok) {
			// With force, constitution.md should be created (overwritten), not skipped
			expect(result.value.created).toContain(".maina/constitution.md");
			expect(result.value.skipped).not.toContain(".maina/constitution.md");
		}
	});

	test("fails if not a git repo", async () => {
		// tmpDir has no .git directory
		const messages: string[] = [];
		const deps = makeDeps({
			log: {
				info: (msg: string) => messages.push(`info:${msg}`),
				error: (msg: string) => messages.push(`error:${msg}`),
				warning: (msg: string) => messages.push(`warning:${msg}`),
				success: (msg: string) => messages.push(`success:${msg}`),
				message: (msg: string) => messages.push(`message:${msg}`),
				step: (msg: string) => messages.push(`step:${msg}`),
			},
		});

		const result = await initAction({ cwd: tmpDir }, deps);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("git");
		}
	});
});
