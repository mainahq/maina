import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	listSpecKitFeatures,
	resolveSpecKitFeature,
	type SpecKitFacts,
} from "../spec-kit";

const ROOT = "/repo";

function facts(overrides: Partial<SpecKitFacts> = {}): SpecKitFacts {
	return {
		root: ROOT,
		initialized: true,
		featureDirectoryEnv: undefined,
		featureJson: undefined,
		branch: "main",
		specsDirs: ["001-photo-albums", "002-sharing"],
		...overrides,
	};
}

describe("resolveSpecKitFeature", () => {
	test("a repository without .specify/ has no Spec Kit feature", () => {
		const result = resolveSpecKitFeature(
			facts({ initialized: false, branch: "001-photo-albums" }),
		);
		expect(result).toEqual({ ok: true, value: null });
	});

	test("SPECIFY_FEATURE_DIRECTORY wins, resolved against the root", () => {
		const result = resolveSpecKitFeature(
			facts({
				featureDirectoryEnv: "specs/002-sharing",
				featureJson: JSON.stringify({
					feature_directory: "specs/001-photo-albums",
				}),
				branch: "001-photo-albums",
			}),
		);
		expect(result).toEqual({
			ok: true,
			value: { dir: join(ROOT, "specs/002-sharing"), source: "env" },
		});
	});

	test(".specify/feature.json names the feature when no env override is set", () => {
		const result = resolveSpecKitFeature(
			facts({
				featureJson: JSON.stringify({
					feature_directory: "specs/002-sharing",
				}),
				branch: "001-photo-albums",
			}),
		);
		expect(result).toEqual({
			ok: true,
			value: { dir: join(ROOT, "specs/002-sharing"), source: "feature.json" },
		});
	});

	test("an absolute feature_directory is kept as is", () => {
		const result = resolveSpecKitFeature(
			facts({
				featureJson: JSON.stringify({ feature_directory: "/elsewhere/003-x" }),
			}),
		);
		expect(result.ok && result.value?.dir).toBe("/elsewhere/003-x");
	});

	test("an unparsable feature.json is an error, never a silent guess", () => {
		const result = resolveSpecKitFeature(facts({ featureJson: "{not json" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("invalid_feature_json");
			expect(result.error.message).toContain("feature.json");
		}
	});

	test("feature.json without feature_directory falls back to the branch", () => {
		const result = resolveSpecKitFeature(
			facts({ featureJson: "{}", branch: "002-sharing" }),
		);
		expect(result).toEqual({
			ok: true,
			value: { dir: join(ROOT, "specs", "002-sharing"), source: "branch" },
		});
	});

	test("a branch matches specs/<branch>, ignoring a prefix like feat/", () => {
		const result = resolveSpecKitFeature(
			facts({ branch: "feat/001-photo-albums" }),
		);
		expect(result).toEqual({
			ok: true,
			value: { dir: join(ROOT, "specs", "001-photo-albums"), source: "branch" },
		});
	});

	test("a branch matches a spec folder by its number prefix", () => {
		const result = resolveSpecKitFeature(facts({ branch: "002-share-links" }));
		expect(result).toEqual({
			ok: true,
			value: { dir: join(ROOT, "specs", "002-sharing"), source: "branch" },
		});
	});

	test("two spec folders with the branch's number prefix are ambiguous", () => {
		const result = resolveSpecKitFeature(
			facts({
				branch: "002-share-links",
				specsDirs: ["002-sharing", "002-share-links-v2"],
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("ambiguous_branch");
			expect(result.error.message).toContain("002");
		}
	});

	test("a timestamp branch matches its spec folder by the full timestamp", () => {
		const specsDirs = ["20260319-091500-albums", "20260319-143022-sharing"];
		const result = resolveSpecKitFeature(
			facts({ branch: "20260319-143022-share-links", specsDirs }),
		);
		expect(result).toEqual({
			ok: true,
			value: {
				dir: join(ROOT, "specs", "20260319-143022-sharing"),
				source: "branch",
			},
		});
	});

	test("a timestamp branch never matches another feature from the same day", () => {
		const result = resolveSpecKitFeature(
			facts({
				branch: "20260319-143022-sharing",
				specsDirs: ["20260319-091500-albums"],
			}),
		);
		expect(result).toEqual({ ok: true, value: null });
	});

	test("a branch that names no spec folder has no feature", () => {
		expect(resolveSpecKitFeature(facts({ branch: "main" }))).toEqual({
			ok: true,
			value: null,
		});
	});
});

describe("listSpecKitFeatures", () => {
	test("lists numbered spec folders, sorted, only in a Spec Kit repository", () => {
		const specsDirs = ["002-sharing", "notes", "001-photo-albums"];
		expect(listSpecKitFeatures(facts({ specsDirs }))).toEqual([
			join(ROOT, "specs", "001-photo-albums"),
			join(ROOT, "specs", "002-sharing"),
		]);
		expect(
			listSpecKitFeatures(facts({ specsDirs, initialized: false })),
		).toEqual([]);
	});
});
