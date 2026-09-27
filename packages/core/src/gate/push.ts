/**
 * Implicit push destinations (#494).
 *
 * A push with no refspec (`git push`, `git push <remote>`) goes where git's
 * config says: `remote.<name>.push` refspecs when the remote has any, else
 * `push.default` (`simple` when unset), and every ref, forced, for a
 * `remote.<name>.mirror` remote. That can name a branch other than the one
 * checked out: under `push.default=upstream` a `feature` branch tracking
 * `origin/master` pushes to `master`.
 *
 * `implicitPush` resolves the destination from a `PushConfig` snapshot, the
 * way git does, and is pure. `readPushConfig` takes the snapshot through the
 * `GitPort`. git's own `@{push}` is not used: it fails when the destination
 * has no remote-tracking ref yet (a branch's first push) and does not
 * understand `HEAD:<dst>` refspecs, and it names one destination where
 * `matching` and glob refspecs push many.
 */

import type { Result } from "../db/index";
import type { GitError, GitPort } from "../ports/git";

/** A branch's `branch.<name>.remote`, `.merge` and `.pushRemote`. */
export type BranchPushConfig = Readonly<{
	remote?: string;
	merge?: string;
	pushRemote?: string;
}>;

/** The config git resolves an implicit push destination from. */
export type PushConfig = Readonly<{
	/** `push.default`; unset means git's default, `simple`. */
	default?: string;
	/** `remote.pushDefault`. */
	pushDefault?: string;
	/** Per branch name. */
	branches: ReadonlyMap<string, BranchPushConfig>;
	/** `remote.<name>.push` refspecs, per remote name. */
	refspecs: ReadonlyMap<string, readonly string[]>;
	/** Remotes with `remote.<name>.mirror` set. */
	mirrors: ReadonlySet<string>;
	/** Local branch names, for `matching` and glob refspecs. */
	localBranches: readonly string[];
}>;

/** Where an implicit push goes. */
export type ImplicitPush = Readonly<{
	/** Remote branches it pushes to (may be fewer when git refuses the push). */
	targets: readonly string[];
	/** The destination could not be resolved: it may be any branch. */
	unknown: boolean;
	/** It force-pushes (a `+` refspec or a mirror remote). */
	force: boolean;
	/** It deletes a remote branch (a refspec with an empty source). */
	deletes: boolean;
}>;

export const EMPTY_PUSH_CONFIG: PushConfig = {
	branches: new Map(),
	refspecs: new Map(),
	mirrors: new Set(),
	localBranches: [],
};

const HEADS = "refs/heads/";
const NONE: ImplicitPush = {
	targets: [],
	unknown: false,
	force: false,
	deletes: false,
};
const UNKNOWN: ImplicitPush = { ...NONE, unknown: true };

const stripHeads = (ref: string): string =>
	ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref;

/** `HEAD` (or `@`) is the checked-out branch; unknown on a detached HEAD. */
const isHead = (ref: string): boolean => ref === "HEAD" || ref === "@";

/**
 * Where `git push [<remote>]` with no refspec goes, from `branch` (the one
 * checked out, undefined when HEAD is detached) and `remote` (the one the
 * command names, undefined for git's default push remote).
 */
export function implicitPush(
	config: PushConfig,
	branch: string | undefined,
	remote: string | undefined,
): ImplicitPush {
	const own = branch === undefined ? undefined : config.branches.get(branch);
	const to =
		remote ?? own?.pushRemote ?? config.pushDefault ?? own?.remote ?? "origin";
	if (config.mirrors.has(to)) return { ...NONE, force: true, unknown: true };
	const specs = config.refspecs.get(to);
	if (specs !== undefined && specs.length > 0) {
		return fromRefspecs(specs, branch, config.localBranches);
	}
	switch (config.default ?? "simple") {
		case "nothing":
			return NONE;
		case "simple":
		case "current":
			return { ...NONE, targets: branch === undefined ? [] : [branch] };
		case "upstream":
		case "tracking":
			// git refuses the push unless it goes to the upstream's remote.
			if (own?.merge === undefined || own.remote !== to) return NONE;
			return { ...NONE, targets: [stripHeads(own.merge)] };
		case "matching":
			return { ...NONE, targets: config.localBranches };
		default:
			return UNKNOWN;
	}
}

function fromRefspecs(
	specs: readonly string[],
	branch: string | undefined,
	locals: readonly string[],
): ImplicitPush {
	const targets: string[] = [];
	let force = false;
	let deletes = false;
	for (const raw of specs) {
		if (raw.startsWith("^")) continue; // A negative refspec only excludes.
		force ||= raw.startsWith("+");
		const spec = raw.replace(/^\+/, "");
		if (spec === ":") {
			targets.push(...locals);
			continue;
		}
		const colon = spec.indexOf(":");
		const src = colon < 0 ? spec : spec.slice(0, colon);
		const dst = colon < 0 ? spec : spec.slice(colon + 1);
		if (src === "") deletes = true;
		if (src.includes("*")) {
			const mapped = globTargets(src, dst, locals);
			if (mapped === null) return { ...UNKNOWN, force };
			targets.push(...mapped);
			continue;
		}
		const name = dst === "" ? src : dst;
		if (isHead(name)) {
			if (branch === undefined) return { ...UNKNOWN, force };
			targets.push(branch);
		} else targets.push(stripHeads(name));
	}
	return { targets, unknown: false, force, deletes };
}

/** Each local branch a glob refspec pushes, mapped to its destination. */
function globTargets(
	src: string,
	dst: string,
	locals: readonly string[],
): string[] | null {
	// Only a glob over local branches maps from them; any other source (such
	// as remote-tracking refs) may push to any branch.
	if (!src.startsWith(HEADS)) return null;
	// git allows exactly one `*` on each side; anything else is not resolved.
	const from = src.slice(HEADS.length).split("*");
	const to = dst.split("*");
	if (from.length !== 2 || to.length !== 2) return null;
	const [prefix = "", suffix = ""] = from;
	const [before = "", after = ""] = to;
	return locals
		.filter(
			(l) =>
				l.length >= prefix.length + suffix.length &&
				l.startsWith(prefix) &&
				l.endsWith(suffix),
		)
		.map((l) =>
			stripHeads(
				before + l.slice(prefix.length, l.length - suffix.length) + after,
			),
		);
}

/** The config keys `implicitPush` reads (sections and names lower-cased by git). */
const CONFIG_KEYS =
	"^(push\\.default|remote\\.pushdefault|remote\\..+\\.(push|mirror)|branch\\..+\\.(remote|merge|pushremote))$";

const BRANCH_FIELDS: ReadonlyMap<string, keyof BranchPushConfig> = new Map([
	["remote", "remote"],
	["merge", "merge"],
	["pushremote", "pushRemote"],
]);

/**
 * A config boolean, read so that it never misses a true one: only git's
 * false spellings (and an integer 0) are false. git reads any other integer
 * as true and refuses any other word, and a key with no value is true.
 */
const isTrue = (value: string | undefined): boolean =>
	value === undefined ||
	!(
		["", "false", "no", "off"].includes(value.trim().toLowerCase()) ||
		/^\s*[-+]?0+\s*$/.test(value)
	);

/**
 * `PushConfig` from `git config -z --get-regexp` output (`key\nvalue\0`
 * records; a key with no value has no newline) and `git for-each-ref
 * --format=%(refname) refs/heads/` output.
 */
export function parsePushConfig(config: string, refs: string): PushConfig {
	let pushDefault: string | undefined;
	let defaultMode: string | undefined;
	const branches = new Map<string, BranchPushConfig>();
	const refspecs = new Map<string, string[]>();
	const mirrors = new Set<string>();
	for (const record of config.split("\0")) {
		if (record === "") continue;
		const nl = record.indexOf("\n");
		const key = nl < 0 ? record : record.slice(0, nl);
		const value = nl < 0 ? undefined : record.slice(nl + 1);
		if (key === "push.default") defaultMode = value;
		else if (key === "remote.pushdefault") pushDefault = value;
		else if (key.startsWith("remote.")) {
			const dot = key.lastIndexOf(".");
			const name = key.slice("remote.".length, dot);
			const variable = key.slice(dot + 1);
			if (variable === "push" && value !== undefined) {
				refspecs.set(name, [...(refspecs.get(name) ?? []), value]);
			} else if (variable === "mirror") {
				if (isTrue(value)) mirrors.add(name);
				else mirrors.delete(name);
			}
		} else if (key.startsWith("branch.") && value !== undefined) {
			const dot = key.lastIndexOf(".");
			const name = key.slice("branch.".length, dot);
			const variable = key.slice(dot + 1);
			const field = BRANCH_FIELDS.get(variable);
			if (field !== undefined) {
				branches.set(name, { ...branches.get(name), [field]: value });
			}
		}
	}
	const localBranches = refs
		.split("\n")
		.filter((ref) => ref.startsWith(HEADS))
		.map(stripHeads);
	return {
		...(defaultMode === undefined ? {} : { default: defaultMode }),
		...(pushDefault === undefined ? {} : { pushDefault }),
		branches,
		refspecs,
		mirrors,
		localBranches,
	};
}

/** `git config --get-regexp` exits 1, and prints nothing, when no key matches. */
const NO_MATCH_EXIT = 1;

/**
 * The push config of the repository at `root`, read-only. Any git failure
 * is an error, never an empty config: an unknown destination may be a
 * protected branch.
 */
export async function readPushConfig(
	git: GitPort,
	root: string,
): Promise<Result<PushConfig, GitError>> {
	const [config, refs] = await Promise.all([
		git.run(root, ["config", "-z", "--get-regexp", CONFIG_KEYS]),
		git.run(root, ["for-each-ref", "--format=%(refname)", HEADS]),
	]);
	if (!refs.ok) return refs;
	if (config.ok) {
		return { ok: true, value: parsePushConfig(config.value, refs.value) };
	}
	const none =
		config.error.kind === "failed" &&
		config.error.exitCode === NO_MATCH_EXIT &&
		config.error.stderr.trim() === "";
	if (!none) return config;
	return { ok: true, value: parsePushConfig("", refs.value) };
}
