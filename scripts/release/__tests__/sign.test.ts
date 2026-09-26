/**
 * Release signatures and the lockstep check (v1 task 9.7, FR-INS-2, spec §8).
 *
 * Every artifact of a release is signed with the release key, and the
 * lockstep check refuses a release that is missing an expected artifact,
 * carries one at another version, or has one whose bytes or signature do
 * not check out against the public key.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	CLI_PACKAGES,
	checkRelease,
	describeProblems,
	EXPECTED,
	MARKETPLACES,
	type Release,
	type ReleaseArtifact,
	renderRelease,
} from "../lockstep";
import { signArtifacts, signBytes, verifySignature } from "../sign";
import { testKeys } from "./support";

const keys = testKeys();
const other = testKeys();
const VERSION = "2.0.0";

/** One file per expected artifact, all at `VERSION`. */
function fixture(): Readonly<{
	files: Map<string, Uint8Array>;
	unsigned: readonly Omit<ReleaseArtifact, "signature" | "sha256">[];
}> {
	const files = new Map<string, Uint8Array>();
	const unsigned = Object.entries(EXPECTED).flatMap(([kind, ids]) =>
		ids.map((id) => {
			const file = `${kind}/${id.replace(/[@/]/g, "_")}`;
			files.set(file, new TextEncoder().encode(`${kind}:${id}:${VERSION}`));
			return {
				kind: kind as ReleaseArtifact["kind"],
				id,
				file,
				version: VERSION,
			};
		}),
	);
	return { files, unsigned };
}

function signedRelease(): Readonly<{
	release: Release;
	files: Map<string, Uint8Array>;
}> {
	const { files, unsigned } = fixture();
	const artifacts = signArtifacts(
		unsigned,
		(file) => files.get(file),
		keys.privatePem,
	);
	if (!artifacts.ok) throw new Error(artifacts.error.file);
	return {
		release: {
			schema: 1,
			version: VERSION,
			dryRun: true,
			artifacts: artifacts.value,
		},
		files,
	};
}

const read =
	(files: Map<string, Uint8Array>) =>
	(file: string): Uint8Array | undefined =>
		files.get(file);

describe("signatures", () => {
	test("a signature verifies with the public key and nothing else", () => {
		const bytes = new TextEncoder().encode("maina");
		const sig = signBytes(bytes, keys.privatePem);
		expect(verifySignature(bytes, sig, keys.publicPem)).toBe(true);
		expect(verifySignature(bytes, sig, other.publicPem)).toBe(false);
		expect(
			verifySignature(new TextEncoder().encode("mainA"), sig, keys.publicPem),
		).toBe(false);
		expect(verifySignature(bytes, "", keys.publicPem)).toBe(false);
		expect(verifySignature(bytes, "not base64 !", keys.publicPem)).toBe(false);
	});

	test("signArtifacts records the sha256 and a signature of every file", () => {
		const { release, files } = signedRelease();
		for (const artifact of release.artifacts) {
			const bytes = files.get(artifact.file) as Uint8Array;
			expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(verifySignature(bytes, artifact.signature, keys.publicPem)).toBe(
				true,
			);
		}
	});

	test("signArtifacts refuses an artifact whose file is missing", () => {
		const { files, unsigned } = fixture();
		files.delete("runtime/windows-x64");
		const signed = signArtifacts(unsigned, read(files), keys.privatePem);
		expect(signed.ok).toBe(false);
		if (!signed.ok)
			expect(signed.error).toEqual({
				kind: "missing_file",
				file: "runtime/windows-x64",
			});
	});
});

describe("the expected artifacts", () => {
	test("the CLI packages are the changesets fixed group", () => {
		const config = JSON.parse(
			readFileSync(
				resolve(import.meta.dir, "..", "..", "..", ".changeset", "config.json"),
				"utf-8",
			),
		) as { fixed: string[][] };
		expect([...CLI_PACKAGES].sort() as string[]).toEqual(
			[...(config.fixed[0] ?? [])].sort(),
		);
	});

	test("cover every OS/arch, every host plugin and every marketplace", () => {
		expect(EXPECTED.runtime).toHaveLength(7);
		expect(EXPECTED.plugin).toEqual([
			"claude",
			"cursor",
			"codex",
			"agent-plugins",
		]);
		expect(MARKETPLACES.map((m) => m.host)).toEqual([
			"claude",
			"cursor",
			"codex",
		]);
	});
});

describe("checkRelease", () => {
	test("passes a complete release, signed, at one version", () => {
		const { release, files } = signedRelease();
		expect(checkRelease(release, read(files), keys.publicPem)).toEqual({
			ok: true,
			value: undefined,
		});
	});

	test("fails when any expected artifact is missing", () => {
		for (const [kind, ids] of Object.entries(EXPECTED)) {
			const { release, files } = signedRelease();
			const id = ids[ids.length - 1] as string;
			const result = checkRelease(
				{
					...release,
					artifacts: release.artifacts.filter(
						(a) => !(a.kind === kind && a.id === id),
					),
				},
				read(files),
				keys.publicPem,
			);
			expect(result.ok).toBe(false);
			if (!result.ok)
				expect(describeProblems(result.error)).toContain(
					`missing ${kind} ${id}`,
				);
		}
	});

	test("fails when an artifact's file is gone", () => {
		const { release, files } = signedRelease();
		files.delete("plugin/codex");
		const result = checkRelease(release, read(files), keys.publicPem);
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(describeProblems(result.error)).toContain(
				"plugin codex: file plugin/codex is missing",
			);
	});

	test("fails when an artifact is at another version", () => {
		const { release, files } = signedRelease();
		const skewed = release.artifacts.map((a) =>
			a.kind === "npm" && a.id === "@mainahq/core"
				? { ...a, version: "1.9.9" }
				: a,
		);
		const result = checkRelease(
			{ ...release, artifacts: skewed },
			read(files),
			keys.publicPem,
		);
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(describeProblems(result.error)).toContain(
				"npm @mainahq/core: version 1.9.9, expected 2.0.0",
			);
	});

	test("fails when an artifact is unsigned, tampered or signed by another key", () => {
		const { release, files } = signedRelease();
		files.set("runtime/darwin-arm64", new TextEncoder().encode("tampered"));
		const artifacts = release.artifacts.map((a): ReleaseArtifact => {
			if (a.kind === "runtime" && a.id === "linux-x64")
				return { ...a, signature: "" };
			if (a.kind === "marketplace" && a.id === "cursor")
				return {
					...a,
					signature: signBytes(
						files.get(a.file) as Uint8Array,
						other.privatePem,
					),
				};
			return a;
		});
		const result = checkRelease(
			{ ...release, artifacts },
			read(files),
			keys.publicPem,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(describeProblems(result.error)).toContain(
				"runtime linux-x64: unsigned",
			);
			expect(describeProblems(result.error)).toContain(
				"runtime darwin-arm64: sha256 mismatch",
			);
			expect(describeProblems(result.error)).toContain(
				"marketplace cursor: bad signature",
			);
		}
	});

	test("fails a release whose version is not semver", () => {
		const { release, files } = signedRelease();
		const result = checkRelease(
			{ ...release, version: "latest" },
			read(files),
			keys.publicPem,
		);
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(describeProblems(result.error)[0]).toContain(
				"not a semantic version",
			);
	});

	test("renderRelease is stable JSON that parses back", () => {
		const { release } = signedRelease();
		const text = renderRelease(release);
		expect(text.endsWith("\n")).toBe(true);
		expect(JSON.parse(text)).toEqual(release);
	});
});
