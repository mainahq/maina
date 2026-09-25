import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY, type Policy } from "@mainahq/core";
import { policyToSandbox, SENSITIVE_HOME_PATHS } from "../policy-to-sandbox";
import type { SandboxOptions } from "../port";

const HOME = "/home/dev";
const ROOT = "/work/.maina/worktrees";
const WORKTREE = `${ROOT}/run-1`;
const HOLDOUT = "/work/.maina/holdout";

function withRules(rules: Partial<Policy["rules"]>): Policy {
	return {
		...DEFAULT_POLICY,
		rules: {
			allow: rules.allow ?? [],
			deny: rules.deny ?? [],
		},
	};
}

function options(
	policy: Policy = DEFAULT_POLICY,
	context: Parameters<typeof policyToSandbox>[3] = { home: HOME },
): SandboxOptions {
	const result = policyToSandbox(policy, WORKTREE, HOLDOUT, context);
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}

describe("policyToSandbox: filesystem", () => {
	test("the worker writes only its own worktree", () => {
		expect(options().writeAllow).toEqual([WORKTREE]);
	});

	test("extra writable directories (temp, agent state) are added", () => {
		const opts = options(DEFAULT_POLICY, {
			home: HOME,
			writable: ["/tmp/maina-run-1", `${HOME}/.codex`],
		});
		expect(opts.writeAllow).toEqual([
			WORKTREE,
			"/tmp/maina-run-1",
			`${HOME}/.codex`,
		]);
	});

	test("the worker's temp dir is passed on", () => {
		const opts = options(DEFAULT_POLICY, { home: HOME, tmpDir: "/tmp/run-1" });
		expect(opts.tmpDir).toBe("/tmp/run-1");
		expect(options().tmpDir).toBeUndefined();
	});

	test("home-directory secrets are unreadable, ~/.ssh first", () => {
		const opts = options();
		expect(SENSITIVE_HOME_PATHS[0]).toBe(".ssh");
		for (const path of SENSITIVE_HOME_PATHS) {
			expect(opts.readDeny).toContain(`${HOME}/${path}`);
		}
	});

	test("other worktrees are unreadable; the worker's own is carved back out", () => {
		const opts = options();
		expect(opts.readDeny).toContain(ROOT);
		expect(opts.readAllow).toContain(WORKTREE);
	});

	test("the holdout directory can be neither read nor written", () => {
		const opts = options();
		expect(opts.readDeny).toContain(HOLDOUT);
		expect(opts.writeDeny).toContain(HOLDOUT);
		expect(opts.readAllow).not.toContain(HOLDOUT);
	});

	test("policy deny rules for reads and writes become sandbox denies", () => {
		const opts = options(
			withRules({
				deny: [
					{ match: "~/.config/secrets", kind: "file.read.outside" },
					{ match: "/etc/shadow", kind: "file.read.outside" },
					{ match: "**/.env", kind: "file.write" },
					{ match: ".github/workflows", kind: "file.write" },
				],
			}),
		);
		expect(opts.readDeny).toContain(`${HOME}/.config/secrets`);
		expect(opts.readDeny).toContain("/etc/shadow");
		expect(opts.writeDeny).toContain(`${WORKTREE}/**/.env`);
		expect(opts.writeDeny).toContain(`${WORKTREE}/.github/workflows`);
	});

	test("rules of other kinds or without a kind do not touch the filesystem", () => {
		const opts = options(
			withRules({
				deny: [{ match: "rm -rf *", kind: "shell" }, { match: "secrets" }],
			}),
		);
		expect(opts.readDeny).not.toContain("secrets");
		expect(opts.writeDeny).toEqual([HOLDOUT]);
	});
});

describe("policyToSandbox: network", () => {
	test("the default policy allows no host", () => {
		expect(options().netAllow).toEqual([]);
		expect(options().netDeny).toEqual([]);
	});

	test("network allow rules become the host allowlist", () => {
		const opts = options(
			withRules({
				allow: [
					{ match: "registry.npmjs.org", kind: "network" },
					{ match: "https://api.github.com/repos/*", kind: "network" },
					{ match: "*.githubusercontent.com", kind: "network" },
					{ match: "http://localhost:3000/health", kind: "network" },
				],
			}),
		);
		expect(opts.netAllow).toEqual([
			"registry.npmjs.org",
			"api.github.com",
			"*.githubusercontent.com",
			"localhost:3000",
		]);
	});

	test("network deny rules become the host denylist", () => {
		const opts = options(
			withRules({ deny: [{ match: "evil.example.com", kind: "network" }] }),
		);
		expect(opts.netDeny).toEqual(["evil.example.com"]);
	});

	test("a match that names no host (a bare *) is not an allowlist entry", () => {
		const opts = options(
			withRules({ allow: [{ match: "*", kind: "network" }] }),
		);
		expect(opts.netAllow).toEqual([]);
	});

	test("carries no credentials: the credential proxy adds them", () => {
		expect(options().credentials).toEqual([]);
	});
});

describe("policyToSandbox: refuses a layout it cannot isolate", () => {
	test.each([
		["the home directory", HOME, `${HOME}/run-1`],
		["an ancestor of home", "/home", "/home/run-1"],
		["the filesystem root", "/", "/run-1"],
	])("worktrees root at %s", (_label, root, worktree) => {
		const result = policyToSandbox(DEFAULT_POLICY, worktree, HOLDOUT, {
			home: HOME,
			worktreesRoot: root,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("invalid_options");
	});

	test("a worktrees root that does not contain the worktree", () => {
		const result = policyToSandbox(DEFAULT_POLICY, WORKTREE, HOLDOUT, {
			home: HOME,
			worktreesRoot: "/elsewhere",
		});
		expect(result.ok).toBe(false);
	});

	test("a holdout directory that contains the worktree", () => {
		const result = policyToSandbox(DEFAULT_POLICY, WORKTREE, "/work", {
			home: HOME,
		});
		expect(result.ok).toBe(false);
	});

	test("relative paths", () => {
		const result = policyToSandbox(DEFAULT_POLICY, "run-1", HOLDOUT, {
			home: HOME,
		});
		expect(result.ok).toBe(false);
	});
});
