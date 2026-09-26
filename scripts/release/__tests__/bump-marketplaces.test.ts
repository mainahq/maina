/**
 * Marketplace bumps (v1 task 9.7, FR-INS-2): the repo change that makes the
 * Claude Code, Cursor and Codex marketplaces serve the release. The
 * marketplaces install from the repo, so the bump rewrites the launcher's
 * runtime manifest (signed, at the release version) and regenerates every
 * host package from it, so each plugin manifest carries the same version.
 */

import { describe, expect, test } from "bun:test";
import { loadSources } from "../../../packages/plugins/src/sources";
import {
	artifactName,
	type Manifest,
	publicKeyXml,
	TARGETS,
} from "../../../packages/runtime/build/standalone";
import {
	bumpMarketplaces,
	LAUNCHER_MANIFEST_PATH,
	pluginManifestVersion,
} from "../bump-marketplaces";
import { MARKETPLACES } from "../lockstep";
import { testKeys } from "./support";

const { publicPem } = testKeys();

const VERSION = "9.9.9";

function manifest(version = VERSION): Manifest {
	return {
		schema: 1,
		version,
		artifacts: Object.fromEntries(
			TARGETS.map((t) => [
				t,
				{
					url: `https://example.test/runtime-v${version}/${artifactName(version, t)}`,
					sha256: "a".repeat(64),
					signature: "c2ln",
				},
			]),
		),
	};
}

function sources() {
	const loaded = loadSources();
	if (!loaded.ok) throw new Error(loaded.error);
	return loaded.value;
}

describe("bumpMarketplaces", () => {
	test("pins the launcher manifest and every plugin at the release version", () => {
		const bumped = bumpMarketplaces(VERSION, manifest(), sources(), publicPem);
		expect(bumped.ok).toBe(true);
		if (!bumped.ok) return;
		const files = new Map(bumped.value.map((f) => [f.path, f.content]));

		const launcher = JSON.parse(files.get(LAUNCHER_MANIFEST_PATH) ?? "{}");
		expect(launcher.version).toBe(VERSION);
		expect(Object.keys(launcher.artifacts)).toEqual([...TARGETS]);

		const pluginManifests = bumped.value.filter((f) =>
			f.path.endsWith("/plugin.json"),
		);
		expect(pluginManifests.map((f) => f.path).sort()).toEqual([
			"packages/plugins/dist/agent-plugins/plugin.json",
			"packages/plugins/dist/claude/.claude-plugin/plugin.json",
			"packages/plugins/dist/codex/plugin.json",
			"packages/plugins/dist/cursor/.cursor-plugin/plugin.json",
		]);
		for (const f of pluginManifests) {
			expect(JSON.parse(f.content).version).toBe(VERSION);
		}
		// Every bundled launcher pins the signed runtime manifest.
		for (const host of ["claude", "cursor", "codex", "agent-plugins"]) {
			expect(
				files.get(`packages/plugins/dist/${host}/launcher/manifest.json`),
			).toBe(files.get(LAUNCHER_MANIFEST_PATH));
		}
		// Every launcher pins the release key, which the repo commits too.
		expect(files.get("packages/runtime/launcher/release.pub.pem")).toBe(
			publicPem,
		);
		expect(files.get("packages/runtime/launcher/release.pub.xml")).toBe(
			publicKeyXml(publicPem),
		);
		for (const host of ["claude", "cursor", "codex", "agent-plugins"]) {
			const launcher = `packages/plugins/dist/${host}/launcher`;
			expect(files.get(`${launcher}/release.pub.pem`)).toBe(publicPem);
			expect(files.get(`${launcher}/release.pub.xml`)).toBe(
				publicKeyXml(publicPem),
			);
		}
		for (const m of MARKETPLACES) {
			expect(files.has(m.listing)).toBe(true);
			expect(pluginManifestVersion(bumped.value, m.listing)).toEqual({
				ok: true,
				value: VERSION,
			});
		}
	});

	test("refuses a runtime manifest at another version", () => {
		const bumped = bumpMarketplaces(
			VERSION,
			manifest("9.9.8"),
			sources(),
			publicPem,
		);
		expect(bumped).toEqual({
			ok: false,
			error: { kind: "version_mismatch", manifest: "9.9.8", release: VERSION },
		});
	});

	test("refuses a runtime manifest missing a target or a signature", () => {
		const full = manifest();
		const { "linux-arm64-musl": _gone, ...rest } = full.artifacts;
		const missing = bumpMarketplaces(
			VERSION,
			{ ...full, artifacts: rest },
			sources(),
			publicPem,
		);
		expect(missing).toEqual({
			ok: false,
			error: { kind: "missing_target", target: "linux-arm64-musl" },
		});

		const unsigned = bumpMarketplaces(
			VERSION,
			{
				...full,
				artifacts: {
					...full.artifacts,
					"darwin-x64": {
						url: "https://x",
						sha256: "a".repeat(64),
						signature: "",
					},
				},
			},
			sources(),
			publicPem,
		);
		expect(unsigned).toEqual({
			ok: false,
			error: { kind: "unsigned_target", target: "darwin-x64" },
		});
	});

	test("a listing whose plugin manifest is gone has no version", () => {
		const bumped = bumpMarketplaces(VERSION, manifest(), sources(), publicPem);
		if (!bumped.ok) throw new Error(bumped.error.kind);
		const withoutCodex = bumped.value.filter(
			(f) => f.path !== "packages/plugins/dist/codex/plugin.json",
		);
		const listing = MARKETPLACES.find((m) => m.host === "codex")?.listing ?? "";
		const version = pluginManifestVersion(withoutCodex, listing);
		expect(version.ok).toBe(false);
	});
});
