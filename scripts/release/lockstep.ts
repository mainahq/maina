/**
 * The lockstep release (v1 task 9.7, FR-INS-2, spec §8): what one release
 * must contain, and the check that refuses anything less. Pure: file bytes
 * come in through `read`.
 *
 * A release is the CLI packages (the changesets `fixed` group), the
 * standalone runtime for every OS/arch, every host plugin package and the
 * marketplace bumps, all at one version, each signed with the release key.
 * `release.json` lists them; `build-all.ts` writes it, `publish-artifacts.ts`
 * refuses to publish one that fails `checkRelease`.
 */

import { HOSTS } from "../../packages/plugins/src/generate";
import {
	CLAUDE_MARKETPLACE_PATH,
	CODEX_MARKETPLACE_PATH,
	CURSOR_MARKETPLACE_PATH,
} from "../../packages/plugins/src/generate/marketplace";
import { sha256Hex, TARGETS } from "../../packages/runtime/build/standalone";
import { verifySignature } from "./sign";

type Result<T, E> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: E }>;

/** The npm packages released together: the changesets `fixed` group. */
export const CLI_PACKAGES = [
	"@mainahq/cli",
	"@mainahq/core",
	"@mainahq/mcp",
	"@mainahq/skills",
] as const;

export type CliPackage = (typeof CLI_PACKAGES)[number];

/** The marketplaces that install a host plugin from the repo. */
export const MARKETPLACES = [
	{ host: "claude", listing: CLAUDE_MARKETPLACE_PATH },
	{ host: "cursor", listing: CURSOR_MARKETPLACE_PATH },
	{ host: "codex", listing: CODEX_MARKETPLACE_PATH },
] as const;

export type ArtifactKind = "npm" | "runtime" | "plugin" | "marketplace";

/** Every artifact a release must carry, by kind and id. */
export const EXPECTED: Readonly<Record<ArtifactKind, readonly string[]>> = {
	npm: CLI_PACKAGES,
	runtime: TARGETS,
	plugin: HOSTS,
	marketplace: MARKETPLACES.map((m) => m.host),
};

export type ReleaseArtifact = Readonly<{
	kind: ArtifactKind;
	/** The package name, runtime target, plugin host or marketplace host. */
	id: string;
	/** Path from the release directory, `/`-separated. */
	file: string;
	/** The version the artifact itself carries. */
	version: string;
	/** Lowercase hex sha256 of the file. */
	sha256: string;
	/** Base64 RSA-SHA256 signature of the file (`<file>.sig` holds it too). */
	signature: string;
}>;

export type Release = Readonly<{
	schema: 1;
	version: string;
	/** Built by a dry run, signed with a throwaway key: never published. */
	dryRun: boolean;
	artifacts: readonly ReleaseArtifact[];
}>;

export type ReleaseProblem = Readonly<
	| { kind: "bad_version"; version: string }
	| { kind: "missing"; artifact: ArtifactKind; id: string }
	| { kind: "duplicate"; artifact: ArtifactKind; id: string }
	| { kind: "missing_file"; artifact: ArtifactKind; id: string; file: string }
	| {
			kind: "version_mismatch";
			artifact: ArtifactKind;
			id: string;
			version: string;
			expected: string;
	  }
	| { kind: "sha256_mismatch"; artifact: ArtifactKind; id: string }
	| { kind: "unsigned"; artifact: ArtifactKind; id: string }
	| { kind: "bad_signature"; artifact: ArtifactKind; id: string }
>;

/** semver 2.0, as `scripts/version-source.ts` accepts it. */
const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export const isSemver = (version: string): boolean => SEMVER.test(version);

function artifactProblems(
	a: ReleaseArtifact,
	version: string,
	read: (file: string) => Uint8Array | undefined,
	publicKeyPem: string,
): readonly ReleaseProblem[] {
	const at = { artifact: a.kind, id: a.id };
	const versionProblem: readonly ReleaseProblem[] =
		a.version === version
			? []
			: [
					{
						kind: "version_mismatch",
						...at,
						version: a.version,
						expected: version,
					},
				];
	const bytes = read(a.file);
	if (bytes === undefined) {
		return [...versionProblem, { kind: "missing_file", ...at, file: a.file }];
	}
	const fileProblems: readonly ReleaseProblem[] =
		sha256Hex(bytes) !== a.sha256
			? [{ kind: "sha256_mismatch", ...at }]
			: a.signature === ""
				? [{ kind: "unsigned", ...at }]
				: verifySignature(bytes, a.signature, publicKeyPem)
					? []
					: [{ kind: "bad_signature", ...at }];
	return [...versionProblem, ...fileProblems];
}

/**
 * Every reason `release` is not a complete lockstep release: an expected
 * artifact missing or listed twice, a file gone, an artifact at another
 * version, or bytes whose sha256 or signature do not check out against
 * `publicKeyPem`.
 */
export function checkRelease(
	release: Release,
	read: (file: string) => Uint8Array | undefined,
	publicKeyPem: string,
): Result<void, readonly ReleaseProblem[]> {
	const versionProblem: readonly ReleaseProblem[] = isSemver(release.version)
		? []
		: [{ kind: "bad_version", version: release.version }];
	const coverage = (Object.keys(EXPECTED) as ArtifactKind[]).flatMap((kind) =>
		EXPECTED[kind].flatMap((id): readonly ReleaseProblem[] => {
			const count = release.artifacts.filter(
				(a) => a.kind === kind && a.id === id,
			).length;
			return count === 0
				? [{ kind: "missing", artifact: kind, id }]
				: count > 1
					? [{ kind: "duplicate", artifact: kind, id }]
					: [];
		}),
	);
	const artifacts = release.artifacts.flatMap((a) =>
		artifactProblems(a, release.version, read, publicKeyPem),
	);
	const problems = [...versionProblem, ...coverage, ...artifacts];
	return problems.length === 0
		? { ok: true, value: undefined }
		: { ok: false, error: problems };
}

export function describeProblem(p: ReleaseProblem): string {
	switch (p.kind) {
		case "bad_version":
			return `release version ${JSON.stringify(p.version)} is not a semantic version`;
		case "missing":
			return `missing ${p.artifact} ${p.id}`;
		case "duplicate":
			return `duplicate ${p.artifact} ${p.id}`;
		case "missing_file":
			return `${p.artifact} ${p.id}: file ${p.file} is missing`;
		case "version_mismatch":
			return `${p.artifact} ${p.id}: version ${p.version}, expected ${p.expected}`;
		case "sha256_mismatch":
			return `${p.artifact} ${p.id}: sha256 mismatch`;
		case "unsigned":
			return `${p.artifact} ${p.id}: unsigned`;
		case "bad_signature":
			return `${p.artifact} ${p.id}: bad signature`;
		default: {
			const never: never = p;
			return String(never);
		}
	}
}

export const describeProblems = (
	problems: readonly ReleaseProblem[],
): readonly string[] => problems.map(describeProblem);

/** `release.json`: two-space JSON with a trailing newline. */
export const renderRelease = (release: Release): string =>
	`${JSON.stringify(release, null, 2)}\n`;

/** A parsed `release.json`, or null when it is not one. */
export function parseRelease(text: string): Release | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	const r = value as Partial<Release> | null;
	return r !== null &&
		typeof r === "object" &&
		r.schema === 1 &&
		typeof r.version === "string" &&
		typeof r.dryRun === "boolean" &&
		Array.isArray(r.artifacts)
		? (r as Release)
		: null;
}
