/**
 * Spec Kit feature input (FR-SPEC-7). Finds the Spec Kit feature a
 * repository is on, so Maina reads its `specs/<feature>/{spec,plan,tasks}.md`
 * as feature input. Pure: the caller gathers the facts (environment,
 * `.specify/feature.json`, branch, the `specs/` listing) and this module only
 * decides.
 *
 * The lookup order is Spec Kit's own (`scripts/bash/common.sh`):
 * `SPECIFY_FEATURE_DIRECTORY`, then `.specify/feature.json`'s
 * `feature_directory`, then the branch (`SPECIFY_FEATURE` or the git branch)
 * matched to a `specs/` folder by name or by its number prefix.
 */

import { isAbsolute, join } from "node:path";
import type { Result } from "../db/index";

export type SpecKitFacts = Readonly<{
	root: string;
	/** Whether `<root>/.specify/` exists; without it nothing is Spec Kit's. */
	initialized: boolean;
	/** `SPECIFY_FEATURE_DIRECTORY`, when set. */
	featureDirectoryEnv: string | undefined;
	/** The raw `<root>/.specify/feature.json`, when present. */
	featureJson: string | undefined;
	/** `SPECIFY_FEATURE`, else the current git branch. */
	branch: string;
	/** Directory names directly under `<root>/specs/`. */
	specsDirs: readonly string[];
}>;

export type SpecKitFeature = Readonly<{
	dir: string;
	source: "env" | "feature.json" | "branch";
}>;

export type SpecKitError =
	| Readonly<{ kind: "invalid_feature_json"; message: string }>
	| Readonly<{
			kind: "ambiguous_branch";
			branch: string;
			matches: readonly string[];
			message: string;
	  }>;

const FEATURE_DIR = /^(\d+)-/;

function underRoot(root: string, dir: string): string {
	return isAbsolute(dir) ? dir : join(root, dir);
}

function featureDirectory(
	featureJson: string,
): Result<string | undefined, SpecKitError> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(featureJson);
	} catch (e) {
		return {
			ok: false,
			error: {
				kind: "invalid_feature_json",
				message: `.specify/feature.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
			},
		};
	}
	const value =
		typeof parsed === "object" && parsed !== null
			? (parsed as Readonly<Record<string, unknown>>).feature_directory
			: undefined;
	return {
		ok: true,
		value: typeof value === "string" && value.trim() !== "" ? value : undefined,
	};
}

function fromBranch(
	facts: SpecKitFacts,
): Result<SpecKitFeature | null, SpecKitError> {
	// Spec Kit's git extension allows prefixes such as `feat/042-name`.
	const name = facts.branch.split("/").pop() ?? "";
	if (name === "") return { ok: true, value: null };
	const found = (dir: string) => ({
		ok: true as const,
		value: { dir: join(facts.root, "specs", dir), source: "branch" as const },
	});
	if (facts.specsDirs.includes(name)) return found(name);
	const number = name.match(FEATURE_DIR)?.[1];
	if (number === undefined) return { ok: true, value: null };
	const matches = facts.specsDirs.filter((d) => d.startsWith(`${number}-`));
	const [only] = matches;
	if (only === undefined) return { ok: true, value: null };
	if (matches.length === 1) return found(only);
	return {
		ok: false,
		error: {
			kind: "ambiguous_branch",
			branch: facts.branch,
			matches,
			message: `branch "${facts.branch}" matches several spec folders with prefix ${number}: ${matches.join(", ")}`,
		},
	};
}

/**
 * The Spec Kit feature the repository is on, `null` when it is not a Spec
 * Kit repository or names no feature. An unparsable `feature.json` or a
 * branch matching several spec folders is an error, never a guess.
 */
export function resolveSpecKitFeature(
	facts: SpecKitFacts,
): Result<SpecKitFeature | null, SpecKitError> {
	if (!facts.initialized) return { ok: true, value: null };
	const env = facts.featureDirectoryEnv?.trim();
	if (env) {
		return {
			ok: true,
			value: { dir: underRoot(facts.root, env), source: "env" },
		};
	}
	if (facts.featureJson !== undefined) {
		const dir = featureDirectory(facts.featureJson);
		if (!dir.ok) return dir;
		if (dir.value !== undefined) {
			return {
				ok: true,
				value: {
					dir: underRoot(facts.root, dir.value),
					source: "feature.json",
				},
			};
		}
	}
	return fromBranch(facts);
}

/** Every numbered `specs/NNN-name` folder of a Spec Kit repository, sorted. */
export function listSpecKitFeatures(
	facts: Pick<SpecKitFacts, "root" | "initialized" | "specsDirs">,
): readonly string[] {
	if (!facts.initialized) return [];
	return facts.specsDirs
		.filter((d) => FEATURE_DIR.test(d))
		.sort()
		.map((d) => join(facts.root, "specs", d));
}
