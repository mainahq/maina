/**
 * The gate policy, as sandbox rules for one worker (FR-SBX-1, FR-SBX-2).
 * Pure: no I/O.
 *
 * - Writes: the worker's worktree (plus any `writable` extras such as its
 *   temp directory), minus policy `file.write` denies and the holdout.
 * - Reads: everywhere except home-directory secrets, the holdout, policy
 *   `file.read.outside` denies and the worktrees root, from which the
 *   worker's own worktree is carved back out, so it cannot read another
 *   worker's.
 * - Network: the hosts of policy `network` allow rules; `network` deny
 *   rules are checked first. Credentials' hosts are added by the adapter.
 *
 * The sandbox is a floor under the gate, not a copy of it: an `ask` or a
 * shell rule has no sandbox form and stays with the gate.
 */

import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Policy, Result, RulePolicy } from "@mainahq/core";
import type { SandboxError, SandboxOptions } from "./port";

/** Home-directory secrets no worker reads, whatever the policy says. */
export const SENSITIVE_HOME_PATHS: readonly string[] = [
	".ssh",
	".aws",
	".gnupg",
	".config/gh",
	".config/gcloud",
	".azure",
	".kube",
	".docker/config.json",
	".netrc",
	".git-credentials",
	".npmrc",
	".pypirc",
];

type SandboxContext = Readonly<{
	/** The home directory whose secrets are denied; the user's by default. */
	home?: string;
	/** The directory holding every worker's worktree; the worktree's parent by default. */
	worktreesRoot?: string;
	/** More directories the worker may write, such as the agent's state dir. */
	writable?: readonly string[];
	/** The worker's own temp directory (see `SandboxOptions.tmpDir`). */
	tmpDir?: string;
}>;

/** `inner` is strictly inside `outer`. */
function isInside(outer: string, inner: string): boolean {
	const prefix = outer.endsWith(sep) ? outer : `${outer}${sep}`;
	return inner !== outer && inner.startsWith(prefix);
}

/**
 * A domain, a `*.` wildcard domain or `localhost`, with an optional port:
 * the host forms the sandbox's allowlist takes.
 */
export const isHostPattern = (host: string): boolean =>
	/^(\*\.)?([a-z0-9-]+\.)*[a-z0-9-]+(:\d{1,5})?$/.test(host);

/** The host a network rule names: `https://api.github.com/x` → `api.github.com`. */
function ruleHost(match: string): string | undefined {
	const withoutScheme = match
		.trim()
		.toLowerCase()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
	const authority = withoutScheme.split(/[/?#]/)[0] ?? "";
	const host = authority.slice(authority.lastIndexOf("@") + 1);
	return isHostPattern(host) ? host : undefined;
}

function hostsOf(rules: readonly RulePolicy[]): string[] {
	return [
		...new Set(
			rules
				.filter((rule) => rule.kind === "network")
				.flatMap((rule) => ruleHost(rule.match) ?? []),
		),
	];
}

/** A rule's path: `~/x` under `home`, relative under `base`, absolute as is. */
function rulePath(match: string, home: string, base: string): string {
	if (match === "~") return home;
	if (match.startsWith("~/")) return join(home, match.slice(2));
	return isAbsolute(match) ? match : join(base, match);
}

function pathsOf(
	rules: readonly RulePolicy[],
	kind: RulePolicy["kind"],
	home: string,
	base: string,
): string[] {
	return rules
		.filter((rule) => rule.kind === kind)
		.map((rule) => rulePath(rule.match, home, base));
}

function invalid(message: string): Result<never, SandboxError> {
	return { ok: false, error: { code: "invalid_options", message } };
}

export function policyToSandbox(
	policy: Policy,
	worktree: string,
	holdoutDir: string,
	context: SandboxContext = {},
): Result<SandboxOptions, SandboxError> {
	const home = context.home ?? homedir();
	const root = context.worktreesRoot ?? dirname(worktree);
	const writable = context.writable ?? [];
	for (const [label, path] of [
		["worktree", worktree],
		["holdout directory", holdoutDir],
		["home directory", home],
		["worktrees root", root],
		...writable.map((dir) => ["writable directory", dir] as const),
		...(context.tmpDir === undefined
			? []
			: [["temp directory", context.tmpDir] as const]),
	] as const) {
		if (!isAbsolute(path)) return invalid(`${label} "${path}" is not absolute`);
	}
	const wt = resolve(worktree);
	const holdout = resolve(holdoutDir);
	const worktreesRoot = resolve(root);
	if (!isInside(worktreesRoot, wt)) {
		return invalid(
			`worktrees root ${worktreesRoot} does not contain the worktree ${wt}`,
		);
	}
	// Denying reads of the home directory (or above it) would hide the
	// agent's own binary and config: the worktrees need a root of their own.
	const resolvedHome = resolve(home);
	if (worktreesRoot === resolvedHome || isInside(worktreesRoot, resolvedHome)) {
		return invalid(
			`worktrees root ${worktreesRoot} is the home directory or above it; give worker worktrees a directory of their own`,
		);
	}
	if (holdout === wt || isInside(holdout, wt)) {
		return invalid(
			`holdout directory ${holdout} contains the worktree ${wt}; the worker could read it`,
		);
	}

	const { allow, deny } = policy.rules;
	return {
		ok: true,
		value: {
			writeAllow: [wt, ...writable],
			writeDeny: [holdout, ...pathsOf(deny, "file.write", home, wt)],
			readDeny: [
				...SENSITIVE_HOME_PATHS.map((path) => join(home, path)),
				holdout,
				worktreesRoot,
				...pathsOf(deny, "file.read.outside", home, wt),
			],
			readAllow: [wt, ...writable],
			netAllow: hostsOf(allow),
			netDeny: hostsOf(deny),
			credentials: [],
			...(context.tmpDir === undefined ? {} : { tmpDir: context.tmpDir }),
		},
	};
}
