/**
 * Publishing a lockstep release (v1 task 9.7, FR-INS-2): one GitHub release
 * carries every artifact with its signature, and nothing is published unless
 * the release passes the lockstep check. A dry-run release (signed with a
 * throwaway key) is never published for real.
 */

import { describe, expect, test } from "bun:test";
import { EXPECTED, type Release, type ReleaseArtifact } from "../lockstep";
import { preparePublish } from "../publish-artifacts";
import { signArtifacts } from "../sign";
import { testKeys } from "./support";

const keys = testKeys();
const VERSION = "2.0.0";

function release(dryRun: boolean): Readonly<{
	release: Release;
	files: Map<string, Uint8Array>;
}> {
	const files = new Map<string, Uint8Array>();
	const unsigned = Object.entries(EXPECTED).flatMap(([kind, ids]) =>
		ids.map((id) => {
			const file = `${kind}/${kind}-${id.replace(/[@/]/g, "")}`;
			files.set(file, new TextEncoder().encode(file));
			return {
				kind: kind as ReleaseArtifact["kind"],
				id,
				file,
				version: VERSION,
			};
		}),
	);
	const signed = signArtifacts(unsigned, (f) => files.get(f), keys.privatePem);
	if (!signed.ok) throw new Error(signed.error.file);
	return {
		release: { schema: 1, version: VERSION, dryRun, artifacts: signed.value },
		files,
	};
}

describe("preparePublish", () => {
	test("plans one GitHub release with every artifact and its signature", () => {
		const { release: r, files } = release(true);
		const plan = preparePublish(r, (f) => files.get(f), keys.publicPem, {
			dryRun: true,
			npm: false,
		});
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.value.tag).toBe(`runtime-v${VERSION}`);
		for (const a of r.artifacts) {
			// Marketplace bumps reach the marketplaces as a pull request.
			const asset = a.kind !== "marketplace";
			expect(plan.value.assets.includes(a.file)).toBe(asset);
			expect(plan.value.assets.includes(`${a.file}.sig`)).toBe(asset);
		}
		expect(plan.value.assets).toContain("release.json");
		expect(plan.value.assets).toContain("release.json.sig");
		expect(plan.value.assets).toContain("runtime/manifest.json");
		expect(plan.value.commands).toHaveLength(1);
		const [gh] = plan.value.commands;
		expect(gh?.slice(0, 4)).toEqual([
			"gh",
			"release",
			"create",
			`runtime-v${VERSION}`,
		]);
	});

	test("adds an npm publish per CLI package when asked", () => {
		const { release: r, files } = release(false);
		const plan = preparePublish(r, (f) => files.get(f), keys.publicPem, {
			dryRun: false,
			npm: true,
		});
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		const npm = plan.value.commands.filter((c) => c[0] === "npm");
		expect(npm).toHaveLength(EXPECTED.npm.length);
		for (const c of npm) {
			expect(c.slice(0, 2)).toEqual(["npm", "publish"]);
			expect(c).toContain("--provenance");
		}
	});

	test("refuses to publish a dry-run release for real", () => {
		const { release: r, files } = release(true);
		expect(
			preparePublish(r, (f) => files.get(f), keys.publicPem, {
				dryRun: false,
				npm: false,
			}),
		).toEqual({ ok: false, error: { kind: "dry_run_release" } });
	});

	test("refuses a release that fails the lockstep check", () => {
		const { release: r, files } = release(false);
		const incomplete = {
			...r,
			artifacts: r.artifacts.filter((a) => a.id !== "darwin-x64"),
		};
		const plan = preparePublish(
			incomplete,
			(f) => files.get(f),
			keys.publicPem,
			{ dryRun: false, npm: false },
		);
		expect(plan.ok).toBe(false);
		if (!plan.ok) {
			expect(plan.error).toEqual({
				kind: "check_failed",
				problems: [{ kind: "missing", artifact: "runtime", id: "darwin-x64" }],
			});
		}
	});
});
