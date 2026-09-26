/**
 * Implicit push destinations (#494): a bare `git push` (or `git push
 * <remote>`) goes where git's config says, not always to the branch of the
 * same name. `implicitPush` resolves it from a `PushConfig` snapshot the way
 * git does (`push.default`, `remote.<name>.push`, `remote.<name>.mirror`);
 * `readPushConfig` takes that snapshot through the `GitPort`.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProcessGit } from "../../git/index";
import type { GitPort } from "../../ports/git";
import { systemProcess } from "../../process/index";
import {
	EMPTY_PUSH_CONFIG,
	implicitPush,
	type PushConfig,
	parsePushConfig,
	readPushConfig,
} from "../push";

const config = (overrides: Partial<PushConfig> = {}): PushConfig => ({
	...EMPTY_PUSH_CONFIG,
	localBranches: ["master", "feature"],
	...overrides,
});

const tracking = (merge: string, remote = "origin") =>
	new Map([["feature", { remote, merge }]]);

describe("implicitPush: push.default", () => {
	test("simple (git's default) pushes to the branch of the same name", () => {
		expect(implicitPush(config(), "feature", undefined)).toEqual({
			targets: ["feature"],
			unknown: false,
			force: false,
			deletes: false,
		});
		expect(
			implicitPush(config({ default: "simple" }), "feature", "origin").targets,
		).toEqual(["feature"]);
	});

	test("current pushes to the branch of the same name", () => {
		expect(
			implicitPush(
				config({ default: "current", branches: tracking("refs/heads/master") }),
				"feature",
				undefined,
			).targets,
		).toEqual(["feature"]);
	});

	test("upstream (and tracking) pushes to the upstream branch", () => {
		for (const mode of ["upstream", "tracking"]) {
			const c = config({
				default: mode,
				branches: tracking("refs/heads/v1/main"),
			});
			expect(implicitPush(c, "feature", undefined).targets).toEqual([
				"v1/main",
			]);
			expect(implicitPush(c, "feature", "origin").targets).toEqual(["v1/main"]);
		}
	});

	test("upstream pushes nowhere to a remote that is not the upstream's", () => {
		const c = config({
			default: "upstream",
			branches: tracking("refs/heads/master"),
		});
		expect(implicitPush(c, "feature", "fork").targets).toEqual([]);
		expect(
			implicitPush(config({ default: "upstream" }), "feature", undefined)
				.targets,
		).toEqual([]);
	});

	test("the push remote comes from pushRemote, then remote.pushDefault, then the upstream remote", () => {
		const c = config({
			default: "upstream",
			pushDefault: "fork",
			branches: tracking("refs/heads/master"),
		});
		// Triangular: pushing to `fork`, whose branch is not the upstream.
		expect(implicitPush(c, "feature", undefined).targets).toEqual([]);
		const refspecs = new Map([["fork", ["HEAD:master"]]]);
		expect(
			implicitPush(
				config({ pushDefault: "fork", refspecs }),
				"feature",
				undefined,
			).targets,
		).toEqual(["master"]);
		const own = new Map([["feature", { pushRemote: "fork" }]]);
		expect(
			implicitPush(
				config({ pushDefault: "other", branches: own, refspecs }),
				"feature",
				undefined,
			).targets,
		).toEqual(["master"]);
	});

	test("matching pushes every local branch", () => {
		expect(
			implicitPush(config({ default: "matching" }), "feature", undefined)
				.targets,
		).toEqual(["master", "feature"]);
	});

	test("nothing pushes nowhere", () => {
		expect(
			implicitPush(config({ default: "nothing" }), "feature", undefined),
		).toEqual({ targets: [], unknown: false, force: false, deletes: false });
	});

	test("a push.default git does not know is unknown", () => {
		expect(
			implicitPush(config({ default: "Upstream" }), "feature", undefined)
				.unknown,
		).toBe(true);
	});

	test("a detached HEAD pushes no branch of its own", () => {
		expect(implicitPush(config(), undefined, undefined).targets).toEqual([]);
		expect(
			implicitPush(
				config({
					default: "upstream",
					branches: tracking("refs/heads/master"),
				}),
				undefined,
				undefined,
			).targets,
		).toEqual([]);
	});
});

describe("implicitPush: remote.<name>.push refspecs", () => {
	const withSpecs = (specs: readonly string[], remote = "origin") =>
		config({
			default: "upstream",
			branches: tracking("refs/heads/feature"),
			refspecs: new Map([[remote, specs]]),
		});

	test("configured refspecs replace push.default", () => {
		expect(
			implicitPush(withSpecs(["HEAD:master"]), "feature", undefined),
		).toEqual({
			targets: ["master"],
			unknown: false,
			force: false,
			deletes: false,
		});
		expect(
			implicitPush(
				withSpecs(["refs/heads/feature:refs/heads/main"]),
				"feature",
				"origin",
			).targets,
		).toEqual(["main"]);
		expect(
			implicitPush(withSpecs(["HEAD"]), "feature", undefined).targets,
		).toEqual(["feature"]);
		expect(
			implicitPush(withSpecs(["master"]), "feature", undefined).targets,
		).toEqual(["master"]);
	});

	test("only the pushed-to remote's refspecs apply", () => {
		expect(
			implicitPush(withSpecs(["HEAD:master"], "fork"), "feature", "origin")
				.targets,
		).toEqual(["feature"]);
		expect(
			implicitPush(withSpecs(["HEAD:master"], "fork"), "feature", "fork")
				.targets,
		).toEqual(["master"]);
	});

	test("a glob refspec maps every local branch", () => {
		expect(
			implicitPush(
				withSpecs(["refs/heads/*:refs/heads/rel/*"]),
				"feature",
				undefined,
			).targets,
		).toEqual(["rel/master", "rel/feature"]);
		expect(
			implicitPush(withSpecs(["refs/heads/*"]), "feature", undefined).targets,
		).toEqual(["master", "feature"]);
	});

	test("a glob with more than one `*` a side is unknown", () => {
		for (const spec of [
			"refs/heads/*/*:refs/heads/rel/*",
			"refs/heads/*:refs/heads/*/*",
		]) {
			expect(
				implicitPush(withSpecs([spec]), "feature", undefined).unknown,
			).toBe(true);
		}
	});

	test("a glob over refs other than local branches is unknown", () => {
		expect(
			implicitPush(
				withSpecs(["refs/remotes/origin/*:refs/heads/*"]),
				"feature",
				undefined,
			).unknown,
		).toBe(true);
	});

	test("`:` pushes the matching branches", () => {
		expect(
			implicitPush(withSpecs([":"]), "feature", undefined).targets,
		).toEqual(["master", "feature"]);
	});

	test("a `+` refspec forces and an empty source deletes", () => {
		expect(
			implicitPush(withSpecs(["+HEAD:feature"]), "feature", undefined).force,
		).toBe(true);
		const deleting = implicitPush(withSpecs([":master"]), "feature", undefined);
		expect(deleting.deletes).toBe(true);
		expect(deleting.targets).toEqual(["master"]);
	});

	test("a negative refspec pushes nothing", () => {
		expect(
			implicitPush(
				withSpecs(["^refs/heads/master", "HEAD:feature"]),
				"feature",
				undefined,
			).targets,
		).toEqual(["feature"]);
	});

	test("HEAD on a detached HEAD is unknown", () => {
		expect(
			implicitPush(withSpecs(["HEAD"]), undefined, undefined).unknown,
		).toBe(true);
	});
});

describe("implicitPush: remote.<name>.mirror", () => {
	test("a mirror remote force-pushes every ref", () => {
		const c = config({ mirrors: new Set(["backup"]) });
		expect(implicitPush(c, "feature", "backup").force).toBe(true);
		expect(implicitPush(c, "feature", "origin").force).toBe(false);
	});
});

describe("parsePushConfig", () => {
	test("reads `git config -z --get-regexp` and `for-each-ref` output", () => {
		const configOut = [
			"push.default\nupstream",
			"remote.pushdefault\nfork",
			"remote.origin.push\nHEAD:master",
			"remote.origin.push\n+refs/heads/*:refs/heads/rel/*",
			"remote.my.remote.push\nHEAD",
			"remote.backup.mirror\ntrue",
			"remote.off.mirror\nfalse",
			"branch.v1/x.y.remote\norigin",
			"branch.v1/x.y.merge\nrefs/heads/v1/main",
			"branch.v1/x.y.pushremote\nfork",
			"",
		].join("\0");
		const parsed = parsePushConfig(
			configOut,
			"refs/heads/master\nrefs/heads/v1/x.y\n",
		);
		expect(parsed.default).toBe("upstream");
		expect(parsed.pushDefault).toBe("fork");
		expect(parsed.refspecs.get("origin")).toEqual([
			"HEAD:master",
			"+refs/heads/*:refs/heads/rel/*",
		]);
		expect(parsed.refspecs.get("my.remote")).toEqual(["HEAD"]);
		expect([...parsed.mirrors]).toEqual(["backup"]);
		expect(parsed.branches.get("v1/x.y")).toEqual({
			remote: "origin",
			merge: "refs/heads/v1/main",
			pushRemote: "fork",
		});
		expect(parsed.localBranches).toEqual(["master", "v1/x.y"]);
	});

	test("a valueless boolean key counts as true", () => {
		expect([...parsePushConfig("remote.backup.mirror\0", "").mirrors]).toEqual([
			"backup",
		]);
	});
});

describe("readPushConfig", () => {
	const fake = (
		answer: (args: readonly string[]) => Awaited<ReturnType<GitPort["run"]>>,
	): GitPort => ({ run: async (_root, args) => answer(args) });

	test("no matching config is an empty config, not an error", async () => {
		const git = fake((args) =>
			args[0] === "config"
				? { ok: false, error: { kind: "failed", exitCode: 1, stderr: "" } }
				: { ok: true, value: "refs/heads/main\n" },
		);
		expect(await readPushConfig(git, "/r")).toEqual({
			ok: true,
			value: { ...EMPTY_PUSH_CONFIG, localBranches: ["main"] },
		});
	});

	test("any other git failure is an error", async () => {
		const broken = fake(() => ({
			ok: false,
			error: { kind: "failed", exitCode: 128, stderr: "fatal" },
		}));
		expect((await readPushConfig(broken, "/r")).ok).toBe(false);
		const refsBroken = fake((args) =>
			args[0] === "config"
				? { ok: true, value: "" }
				: { ok: false, error: { kind: "failed", exitCode: 1, stderr: "" } },
		);
		expect((await readPushConfig(refsBroken, "/r")).ok).toBe(false);
	});

	describe("over a real repository", () => {
		let base = "";
		const git = createProcessGit(systemProcess);
		const run = (cwd: string, ...args: string[]) => {
			const p = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe" });
			if (p.exitCode !== 0) throw new Error(p.stderr.toString());
		};
		beforeAll(() => {
			base = realpathSync(mkdtempSync(join(tmpdir(), "maina-push-")));
		});
		afterAll(() => {
			if (base) rmSync(base, { recursive: true, force: true });
		});

		test("resolves push.default=upstream and push refspecs from the repo's config", async () => {
			const repo = join(base, "work");
			run(base, "init", "-q", "-b", "feature", repo);
			run(repo, "config", "push.default", "upstream");
			run(repo, "config", "branch.feature.remote", "origin");
			run(repo, "config", "branch.feature.merge", "refs/heads/v1/main");
			const upstream = await readPushConfig(git, repo);
			if (!upstream.ok) throw new Error("read failed");
			expect(
				implicitPush(upstream.value, "feature", undefined).targets,
			).toEqual(["v1/main"]);
			run(repo, "config", "--unset", "push.default");
			run(repo, "config", "remote.origin.push", "HEAD:master");
			const refspec = await readPushConfig(git, repo);
			if (!refspec.ok) throw new Error("read failed");
			expect(implicitPush(refspec.value, "feature", undefined).targets).toEqual(
				["master"],
			);
		});

		test("outside a repository it is an error", async () => {
			const loose = join(base, "loose");
			mkdirSync(loose);
			expect((await readPushConfig(git, loose)).ok).toBe(false);
			expect((await readPushConfig(git, join(base, "missing"))).ok).toBe(false);
		});
	});
});
