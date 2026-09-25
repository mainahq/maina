/**
 * Tests for the rules-only PreToolUse bootstrap hook (#286, FR-DOG-1/2).
 *
 * The hook is scaffolding that Phase 4 replaces; these tests pin the fixed
 * deny list, the "benign commands stay untouched" guarantee, and the
 * fail-closed behaviour (any crash resolves to `ask`).
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	evaluate,
	type HookContext,
	type HookInput,
	runHook,
} from "../../../.maina/dogfood/hook-bootstrap";

const REPO = "/work/maina";
const HOME = "/Users/dev";

const ctx: HookContext = {
	repoRoot: REPO,
	home: HOME,
	tmpDirs: ["/tmp", "/private/tmp", "/var/folders"],
	currentBranch: "v1/286-dogfood-bootstrap",
	override: false,
	now: () => "2026-09-25T10:00:00.000Z",
};

const bash = (command: string): HookInput => ({
	tool_name: "Bash",
	tool_input: { command },
	cwd: REPO,
});

const write = (file_path: string, content = "x"): HookInput => ({
	tool_name: "Write",
	tool_input: { file_path, content },
	cwd: REPO,
});

// Secret-shaped fixtures are assembled at runtime so this file itself never
// contains a literal token (secretlint + the hook's own content rule).
const FAKE_GH_TOKEN = `gh${"p_"}${"A1b2C3d4".repeat(4)}abcd`;
const FAKE_PRIVATE_KEY = `-----BEGIN ${"OPENSSH"} PRIVATE KEY-----\nabc\n`;

describe("evaluate: deny list", () => {
	const denied: ReadonlyArray<readonly [string, HookInput]> = [
		// destructive shell
		["rm -rf /", bash("rm -rf /")],
		["rm -rf ~", bash("rm -rf ~")],
		["rm -rf $HOME", bash("rm -rf $HOME")],
		["rm -fr . (whole repo)", bash("rm -fr .")],
		["rm -rf outside repo", bash("rm -rf /work/other-project")],
		["rm -r ../ (parent)", bash("rm -r ../")],
		["chained rm -rf /", bash("bun test && rm -rf /")],
		["sudo", bash("sudo rm file")],
		["mkfs", bash("mkfs.ext4 /dev/sda1")],
		["dd to device", bash("dd if=/dev/zero of=/dev/disk2")],
		["fork bomb", bash(":(){ :|:& };:")],
		// writes outside the repo
		["Write outside repo", write("/etc/hosts")],
		["Write into home", write(`${HOME}/.zshrc`)],
		[
			"Edit outside repo",
			{
				tool_name: "Edit",
				tool_input: { file_path: "/work/other/src/a.ts" },
				cwd: REPO,
			},
		],
		["relative escape", write("../other/file.ts")],
		["redirect outside repo", bash("echo hi > /etc/motd")],
		["tee outside repo", bash("echo hi | tee -a /Users/dev/.bashrc")],
		["cp outside repo", bash("cp secrets.txt /Users/dev/Desktop/")],
		// secrets
		[
			"Read .env",
			{ tool_name: "Read", tool_input: { file_path: `${REPO}/.env` } },
		],
		[
			"Read .env.local",
			{ tool_name: "Read", tool_input: { file_path: `${REPO}/.env.local` } },
		],
		[
			"Read ssh key",
			{ tool_name: "Read", tool_input: { file_path: `${HOME}/.ssh/id_rsa` } },
		],
		[
			"Grep ssh dir",
			{ tool_name: "Grep", tool_input: { pattern: "x", path: `${HOME}/.ssh` } },
		],
		["cat .env", bash("cat .env")],
		["cat aws creds", bash("cat ~/.aws/credentials")],
		["gh auth token", bash("gh auth token")],
		["printenv dump", bash("printenv")],
		["echo token var", bash("echo $NPM_TOKEN")],
		["write token into file", write(`${REPO}/src/a.ts`, FAKE_GH_TOKEN)],
		["write private key", write(`${REPO}/key.txt`, FAKE_PRIVATE_KEY)],
		// publish / push to protected branches
		["npm publish", bash("npm publish --access public")],
		["bun publish", bash("bun publish")],
		["changeset publish", bash("bunx changeset publish")],
		["release script", bash("bun run release")],
		["gh release create", bash("gh release create v2.0.0")],
		["push to master", bash("git push origin master")],
		["push HEAD:v1/main", bash("git push origin HEAD:v1/main")],
		["force push main", bash("git push -f origin +main")],
		["delete protected", bash("git push origin --delete v1/main")],
		["delete via colon", bash("git push origin :master")],
		["push --all", bash("git push --all origin")],
		[
			"bare push on protected branch",
			// currentBranch comes from context below
			bash("git push"),
		],
	];

	for (const [name, input] of denied) {
		test(`denies: ${name}`, () => {
			const c =
				name === "bare push on protected branch"
					? { ...ctx, currentBranch: "v1/main" }
					: ctx;
			const d = evaluate(input, c);
			expect(d.verdict).toBe("deny");
			expect(d.reason.length).toBeGreaterThan(0);
		});
	}
});

describe("evaluate: benign commands are left alone", () => {
	const allowed: ReadonlyArray<readonly [string, HookInput]> = [
		["bun test", bash("bun test scripts/dogfood")],
		["bun run verify", bash("bun run verify")],
		["git status", bash("git status && git diff --stat")],
		["push feature branch", bash("git push -u origin HEAD")],
		[
			"push named feature branch",
			bash("git push origin v1/286-dogfood-bootstrap"),
		],
		[
			"force-with-lease feature",
			bash("git push --force-with-lease origin v1/286-x"),
		],
		["gh pr create", bash('gh pr create --base v1/main --title "x" --body y')],
		["gh pr view", bash("gh pr view 12 --json comments")],
		["rm -rf dist", bash("rm -rf dist node_modules/.cache")],
		["rm -rf in tmp", bash("rm -rf /tmp/maina-test-123")],
		["redirect to dev/null", bash("bun test > /dev/null 2>&1")],
		["redirect in repo", bash("echo hi > out.txt")],
		["redirect to tmp", bash("gh pr view 1 > /tmp/pr.json")],
		["Write in repo", write(`${REPO}/scripts/dogfood/report.ts`)],
		["Write relative in repo", write("packages/core/src/a.ts")],
		["Write in tmp", write("/private/tmp/claude/scratch.md")],
		[
			"Read .env.example",
			{ tool_name: "Read", tool_input: { file_path: `${REPO}/.env.example` } },
		],
		[
			"Read source",
			{ tool_name: "Read", tool_input: { file_path: `${REPO}/package.json` } },
		],
		["Glob", { tool_name: "Glob", tool_input: { pattern: "**/*.ts" } }],
		["echo env word", bash("echo environment ready")],
		["maina commit", bash('bun packages/cli/dist/index.js commit -m "x"')],
	];

	for (const [name, input] of allowed) {
		test(`allows: ${name}`, () => {
			expect(evaluate(input, ctx).verdict).toBe("allow");
		});
	}
});

describe("runHook", () => {
	test("deny emits a PreToolUse deny decision and a log record", () => {
		const out = runHook(JSON.stringify(bash("rm -rf /")), ctx);
		const parsed = JSON.parse(out.stdout);
		expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
		expect(out.record).toMatchObject({
			ts: "2026-09-25T10:00:00.000Z",
			tool: "Bash",
			action: "rm -rf /",
			verdict: "deny",
		});
		expect(out.record.override).toBeUndefined();
	});

	test("allow emits nothing so the normal permission flow applies", () => {
		const out = runHook(JSON.stringify(bash("bun test")), ctx);
		expect(out.stdout).toBe("");
		expect(out.record.verdict).toBe("allow");
	});

	test("override downgrades deny to ask and records it", () => {
		const out = runHook(JSON.stringify(bash("git push origin master")), {
			...ctx,
			override: true,
		});
		const parsed = JSON.parse(out.stdout);
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("ask");
		expect(out.record.verdict).toBe("ask");
		expect(out.record.override).toBe(true);
	});

	test("malformed stdin resolves to ask (fail closed)", () => {
		const out = runHook("{not json", ctx);
		const parsed = JSON.parse(out.stdout);
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("ask");
		expect(out.record.verdict).toBe("ask");
		expect(out.record.reason).toContain("crash");
	});

	test("an evaluator crash resolves to ask (fail closed)", () => {
		const boom = (): never => {
			throw new Error("boom");
		};
		const out = runHook(JSON.stringify(bash("ls")), ctx, boom);
		const parsed = JSON.parse(out.stdout);
		expect(parsed.hookSpecificOutput.permissionDecision).toBe("ask");
		expect(out.record.reason).toContain("boom");
	});

	test("long actions are truncated in the log", () => {
		const out = runHook(JSON.stringify(bash(`echo ${"a".repeat(500)}`)), ctx);
		expect(out.record.action.length).toBeLessThanOrEqual(200);
	});
});

describe("repo wiring", () => {
	const root = resolve(import.meta.dir, "../../..");

	function hookCommand(): string {
		const settings = JSON.parse(
			readFileSync(join(root, ".claude/settings.json"), "utf-8"),
		);
		const entries = settings.hooks.PreToolUse as Array<{
			hooks: Array<{ type: string; command: string }>;
		}>;
		const cmd = entries[0]?.hooks[0]?.command;
		expect(typeof cmd).toBe("string");
		return cmd as string;
	}

	async function runShell(
		command: string,
		stdin: string,
		env: Record<string, string>,
	): Promise<string> {
		const proc = Bun.spawn(["sh", "-c", command], {
			stdin: new Blob([stdin]),
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...env },
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		return out;
	}

	test("settings.json hook denies a destructive command end-to-end", async () => {
		const logDir = mkdtempSync(join(tmpdir(), "maina-dogfood-log-"));
		try {
			const out = await runShell(
				hookCommand(),
				JSON.stringify(bash("rm -rf /")),
				{
					CLAUDE_PROJECT_DIR: root,
					MAINA_DOGFOOD_LOG: join(logDir, "log.jsonl"),
				},
			);
			expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe(
				"deny",
			);
			const line = readFileSync(join(logDir, "log.jsonl"), "utf-8").trim();
			expect(JSON.parse(line).verdict).toBe("deny");
		} finally {
			rmSync(logDir, { recursive: true, force: true });
		}
	});

	test("settings.json hook fails closed to ask when the script cannot run", async () => {
		const empty = mkdtempSync(join(tmpdir(), "maina-dogfood-missing-"));
		try {
			const out = await runShell(hookCommand(), JSON.stringify(bash("ls")), {
				CLAUDE_PROJECT_DIR: empty,
			});
			expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe("ask");
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});
});
