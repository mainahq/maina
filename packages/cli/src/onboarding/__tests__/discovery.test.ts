/**
 * Teammate discovery (FR-RET-4): how a developer who has never heard of
 * Maina finds it.
 *
 * 1. The PR receipt comment ends with a one-line "what is this" footer. It
 *    shows by default; the repo policy (`discovery.receipt_line: false`)
 *    turns it off.
 * 2. When the repo commits a policy file, the managed region of every agent
 *    instruction file carries an install hint. The hint is a shell check the
 *    agent runs: it prints only when `maina` is not installed, and only once
 *    per developer (a marker under `~/.maina/`).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	analyzeAction,
	computeReceiptHash,
	DEFAULT_POLICY,
	discoveryLineEnabled,
	type HttpPort,
	type HttpRequest,
	loadShellParser,
	parsePolicyLayer,
	type Receipt,
} from "@mainahq/core";
import { receiptPublishAction } from "../../commands/receipt-publish";
import {
	INSTALL_CHECK_COMMAND,
	INSTALL_HINT_HEADING,
	installHintScript,
	isPolicyCommitted,
	renderInstallHint,
} from "../discovery";
import { type OnboardingFacts, planOnboarding } from "../plan";
import { AGENT_FILES } from "../setup/agent-files/index";
import type { StackContext } from "../setup/agent-files/types";

const DISCOVERY_TEXT = "Verified by [Maina](https://mainahq.com)";
const SHA = "e".repeat(40);

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "maina-discovery-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

// ── 1. The discovery line on the PR comment ─────────────────────────────────

function signedReceipt(): Receipt {
	const body: Omit<Receipt, "hash"> = {
		prTitle: "Add retry",
		repo: "acme/widgets",
		timestamp: "2026-09-26T10:00:00Z",
		status: "passed",
		diff: { additions: 5, deletions: 1, files: 2 },
		agent: { id: "claude-code", modelVersion: "claude-opus-5-5" },
		promptVersion: {
			constitutionHash: "a".repeat(64),
			promptsHash: "b".repeat(64),
		},
		checks: [
			{
				id: "biome",
				name: "Biome",
				status: "passed",
				tool: "biome",
				findings: [],
			},
		],
		walkthrough: "Adds a retry.",
		feedback: [],
		retries: 0,
	};
	const hash = computeReceiptHash(body);
	if (!hash.ok) throw new Error(hash.message);
	return { ...body, hash: hash.data };
}

function recordingHttp(): { http: HttpPort; requests: HttpRequest[] } {
	const requests: HttpRequest[] = [];
	return {
		requests,
		http: {
			request: async (req) => {
				requests.push(req);
				if (req.method === "GET") {
					const body = req.url.includes("check-runs")
						? { total_count: 0, check_runs: [] }
						: [];
					return {
						ok: true,
						value: { status: 200, body: JSON.stringify(body) },
					};
				}
				return {
					ok: true,
					value: { status: 201, body: JSON.stringify({ id: 42 }) },
				};
			},
		},
	};
}

async function publishedCommentBody(
	options: { discoveryLine?: boolean } = {},
): Promise<string> {
	const receipt = join(dir, "receipt.json");
	writeFileSync(receipt, JSON.stringify(signedReceipt()));
	const { http, requests } = recordingHttp();
	const result = await receiptPublishAction(
		{
			receipt,
			pr: "7",
			sha: SHA,
			repo: "acme/widgets",
			optIn: true,
			cwd: dir,
			...options,
		},
		{ http, env: (name) => (name === "GITHUB_TOKEN" ? "tok" : undefined) },
	);
	expect(result.ok && result.outcome.kind).toBe("published");
	const post = requests.find(
		(r) => r.method === "POST" && r.url.endsWith("/issues/7/comments"),
	);
	return JSON.parse(post?.body ?? "{}").body as string;
}

function writePolicy(policy: unknown): void {
	mkdirSync(join(dir, ".maina"), { recursive: true });
	writeFileSync(join(dir, ".maina", "policy.json"), JSON.stringify(policy));
}

describe("discovery line", () => {
	test("shows by default on the PR comment", async () => {
		expect(await publishedCommentBody()).toContain(DISCOVERY_TEXT);
	});

	test("shows when the repo policy exists but says nothing about it", async () => {
		writePolicy({ version: 1, protected_branches: ["main"] });
		expect(await publishedCommentBody()).toContain(DISCOVERY_TEXT);
	});

	test("disappears when the repo policy turns it off", async () => {
		writePolicy({ version: 1, discovery: { receipt_line: false } });
		expect(await publishedCommentBody()).not.toContain(DISCOVERY_TEXT);
	});

	test("an error elsewhere in the policy does not bring it back", async () => {
		writePolicy({ unknown_key: 1, discovery: { receipt_line: false } });
		expect(await publishedCommentBody()).not.toContain(DISCOVERY_TEXT);
	});

	test("the policy cannot be overridden back on from the command line", async () => {
		writePolicy({ discovery: { receipt_line: false } });
		expect(await publishedCommentBody({ discoveryLine: true })).not.toContain(
			DISCOVERY_TEXT,
		);
	});

	test("--no-discovery-line still turns it off without a policy", async () => {
		expect(await publishedCommentBody({ discoveryLine: false })).not.toContain(
			DISCOVERY_TEXT,
		);
	});

	test("the policy key is valid in a policy file", () => {
		expect(parsePolicyLayer({ discovery: { receipt_line: false } }).ok).toBe(
			true,
		);
		expect(parsePolicyLayer({ discovery: { receipt_line: "no" } }).ok).toBe(
			false,
		);
	});

	test("discoveryLineEnabled: default on, either switch turns it off", () => {
		expect(discoveryLineEnabled({})).toBe(true);
		expect(discoveryLineEnabled({ policy: {} })).toBe(true);
		expect(
			discoveryLineEnabled({ policy: { discovery: { receipt_line: true } } }),
		).toBe(true);
		expect(
			discoveryLineEnabled({ policy: { discovery: { receipt_line: false } } }),
		).toBe(false);
		expect(discoveryLineEnabled({ flag: false })).toBe(false);
	});
});

// ── 2. The install hint in agent instruction files ──────────────────────────

const STACK: StackContext = {
	languages: ["typescript"],
	frameworks: [],
	packageManager: "bun",
	buildTool: null,
	linters: ["biome"],
	testRunners: ["bun:test"],
	cicd: ["github-actions"],
	repoSize: { files: 10, bytes: 1000 },
	isEmpty: false,
	isLarge: false,
};

function facts(policyCommitted: boolean): OnboardingFacts {
	return {
		stack: STACK,
		constitution: "# Constitution\n\n- Tests first.\n",
		mcpEntry: { command: "maina", args: ["--mcp"] },
		files: new Map(),
		policyCommitted,
	};
}

function agentOps(policyCommitted: boolean) {
	const agentPaths = new Set(AGENT_FILES.map((f) => f.path));
	return planOnboarding(facts(policyCommitted)).filter((op) =>
		agentPaths.has(op.path),
	);
}

describe("install hint in the managed region", () => {
	test("every agent instruction file carries it when a policy file is committed", () => {
		const ops = agentOps(true);
		expect(ops).toHaveLength(AGENT_FILES.length);
		for (const op of ops) {
			expect(op.content).toContain(INSTALL_HINT_HEADING);
			expect(op.content).toContain(installHintScript());
		}
	});

	test("no agent instruction file carries it without a committed policy file", () => {
		for (const op of agentOps(false)) {
			expect(op.content).not.toContain(INSTALL_HINT_HEADING);
		}
		const { policyCommitted: _, ...withoutFlag } = facts(false);
		for (const op of planOnboarding(withoutFlag)) {
			expect(op.content).not.toContain(INSTALL_HINT_HEADING);
		}
	});

	test("the hint sits inside the managed region, so re-runs keep it in step", () => {
		const claude = agentOps(true).find((op) => op.path === "CLAUDE.md");
		const content = claude?.content ?? "";
		const start = content.indexOf("<!-- maina-managed:start -->");
		const end = content.indexOf("<!-- maina-managed:end -->");
		const hint = content.indexOf(INSTALL_HINT_HEADING);
		expect(start).toBeGreaterThanOrEqual(0);
		expect(hint).toBeGreaterThan(start);
		expect(hint).toBeLessThan(end);
	});
});

describe("install hint for a developer who has maina (and its gate)", () => {
	/** Gate verdicts for a shell command under the default policy. */
	async function verdicts(command: string): Promise<readonly string[]> {
		const shell = await loadShellParser();
		if (!shell.ok) throw new Error(shell.error.message);
		const analysis = analyzeAction(
			{
				host: "claude-code",
				sessionId: "s",
				root: dir,
				permissionMode: "default",
				untrusted: [],
				kind: "shell",
				action: { command },
			},
			{
				shell: shell.value,
				home: join(dir, "home"),
				protectedBranches: ["main"],
			},
		);
		return analysis.classes.map(
			(c) => DEFAULT_POLICY.action_classes[c]?.verdict ?? "ask",
		);
	}

	test("the per-session step the agent always runs is allowed by the gate", async () => {
		// The agent files tell every agent to run this first; only when it
		// finds no maina does the marker-writing script run. So a developer
		// with the gate installed is never asked about a write to ~/.maina.
		expect(renderInstallHint()).toContain(`\`${INSTALL_CHECK_COMMAND}\``);
		const found = await verdicts(INSTALL_CHECK_COMMAND);
		expect(found.length).toBeGreaterThan(0);
		for (const verdict of found) expect(verdict).toBe("allow");
	});

	test("the marker-writing script is only run when the check finds no maina", () => {
		const hint = renderInstallHint();
		expect(hint.indexOf(INSTALL_CHECK_COMMAND)).toBeLessThan(
			hint.indexOf(installHintScript()),
		);
		expect(hint).toMatch(/only if it prints nothing/i);
	});
});

describe("install hint check (run by the agent)", () => {
	/** A PATH with `sh` tools but no `maina`, plus an isolated HOME. */
	function runHint(opts: { home: string; mainaInstalled: boolean }): string {
		const bin = join(dir, "bin");
		mkdirSync(bin, { recursive: true });
		const maina = join(bin, "maina");
		if (opts.mainaInstalled) {
			writeFileSync(maina, "#!/bin/sh\nexit 0\n");
			chmodSync(maina, 0o755);
		} else {
			rmSync(maina, { force: true });
		}
		const proc = Bun.spawnSync(["/bin/sh", "-c", installHintScript()], {
			cwd: dir,
			env: { PATH: `${bin}:/usr/bin:/bin`, HOME: opts.home },
		});
		expect(proc.exitCode).toBe(0);
		return proc.stdout.toString();
	}

	test("prints the install command when maina is not installed", () => {
		const out = runHint({ home: join(dir, "home"), mainaInstalled: false });
		expect(out).toContain("npm install -g @mainahq/cli");
		expect(out).toContain(".maina/policy.json");
	});

	test("stays silent when maina is installed", () => {
		const home = join(dir, "home");
		expect(runHint({ home, mainaInstalled: true })).toBe("");
	});

	test("is shown once per developer", () => {
		const home = join(dir, "home");
		expect(runHint({ home, mainaInstalled: false })).not.toBe("");
		expect(runHint({ home, mainaInstalled: false })).toBe("");
		// A different developer (another HOME) still sees it once.
		const other = join(dir, "other-home");
		expect(runHint({ home: other, mainaInstalled: false })).not.toBe("");
	});

	test("an installed maina does not use up the one showing", () => {
		const home = join(dir, "home");
		expect(runHint({ home, mainaInstalled: true })).toBe("");
		expect(runHint({ home, mainaInstalled: false })).not.toBe("");
	});
});

describe("isPolicyCommitted", () => {
	function git(...args: string[]): void {
		const proc = Bun.spawnSync(["git", ...args], {
			cwd: dir,
			env: {
				PATH: process.env.PATH ?? "/usr/bin:/bin",
				HOME: dir,
				GIT_AUTHOR_NAME: "t",
				GIT_AUTHOR_EMAIL: "t@example.com",
				GIT_COMMITTER_NAME: "t",
				GIT_COMMITTER_EMAIL: "t@example.com",
			},
		});
		if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
	}

	test("false outside a git repository", async () => {
		writePolicy({ version: 1 });
		expect(await isPolicyCommitted(dir)).toBe(false);
	});

	test("false when the policy file exists but is not committed", async () => {
		git("init", "-q");
		writePolicy({ version: 1 });
		expect(await isPolicyCommitted(dir)).toBe(false);
	});

	test("true once the policy file is committed", async () => {
		git("init", "-q");
		writePolicy({ version: 1 });
		git("add", ".maina/policy.json");
		git("commit", "-q", "-m", "policy");
		expect(await isPolicyCommitted(dir)).toBe(true);
	});
});
