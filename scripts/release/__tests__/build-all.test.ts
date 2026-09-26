/**
 * Lockstep release dry run (v1 task 9.7, FR-INS-2, spec §8).
 *
 * One run builds the CLI packages, the runtime for every OS/arch, the host
 * plugin packages and the marketplace bumps, all at the CLI version, signs
 * every artifact with the release key (a throwaway key here, as on CI's dry
 * run), and fails when any of them is missing or at another version. Packing
 * and compiling are injected, so the test runs without `bun build --compile`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadSources } from "../../../packages/plugins/src/sources";
import {
	artifactName,
	TARGETS,
} from "../../../packages/runtime/build/standalone";
import { type BuildPorts, buildAll } from "../build-all";
import {
	CLI_PACKAGES,
	checkRelease,
	describeProblems,
	EXPECTED,
	MARKETPLACES,
	type Release,
	renderRelease,
} from "../lockstep";
import { preparePublish } from "../publish-artifacts";
import { readFrom, verifySignature } from "../sign";
import { untarGz } from "../tar";
import { testKeys } from "./support";

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const VERSION = (
	JSON.parse(
		readFileSync(join(ROOT, "packages", "cli", "package.json"), "utf-8"),
	) as { version: string }
).version;
const keys = testKeys();

function sources() {
	const loaded = loadSources();
	if (!loaded.ok) throw new Error(loaded.error);
	return loaded.value;
}

/** Fake packer and compiler; `skew` reports a package at another version. */
function ports(
	options: Readonly<{
		skew?: Readonly<Record<string, string>>;
		failTarget?: string;
	}> = {},
): BuildPorts {
	return {
		pack: async (pkg, outDir) => {
			const version = options.skew?.[pkg] ?? VERSION;
			const file = join(
				outDir,
				`${pkg.replace("@", "").replace("/", "-")}-${version}.tgz`,
			);
			writeFileSync(file, `tarball ${pkg}@${version}`);
			return { ok: true, value: { file, version } };
		},
		compile: async (target, outfile) => {
			if (target === options.failTarget) {
				return { ok: false, error: `cannot compile ${target}` };
			}
			writeFileSync(outfile, `runtime ${target}`);
			return { ok: true, value: undefined };
		},
	};
}

let out = "";
beforeEach(() => {
	out = mkdtempSync(join(tmpdir(), "maina-release-"));
});
afterEach(() => {
	rmSync(out, { recursive: true, force: true });
});

async function dryRun(p: BuildPorts = ports()) {
	return buildAll({
		out,
		version: VERSION,
		dryRun: true,
		signingKeyPem: keys.privatePem,
		sources: sources(),
		ports: p,
	});
}

async function built(): Promise<Release> {
	const result = await dryRun();
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
}

describe("dry-run release", () => {
	test("produces every artifact, at the CLI version, each signed", async () => {
		const release = await built();
		expect(release.version).toBe(VERSION);
		expect(release.dryRun).toBe(true);

		const ids = (kind: string) =>
			release.artifacts.filter((a) => a.kind === kind).map((a) => a.id);
		expect(ids("npm")).toEqual([...CLI_PACKAGES]);
		expect(ids("runtime")).toEqual([...TARGETS]);
		expect(ids("plugin")).toEqual([...EXPECTED.plugin]);
		expect(ids("marketplace")).toEqual(MARKETPLACES.map((m) => m.host));

		for (const a of release.artifacts) {
			expect(a.version).toBe(VERSION);
			const bytes = new Uint8Array(readFileSync(join(out, a.file)));
			expect(verifySignature(bytes, a.signature, keys.publicPem)).toBe(true);
			expect(readFileSync(join(out, `${a.file}.sig`), "utf-8").trim()).toBe(
				a.signature,
			);
		}
		expect(
			release.artifacts.filter((a) => a.kind === "runtime").map((a) => a.file),
		).toEqual(TARGETS.map((t) => `runtime/${artifactName(VERSION, t)}`));
	});

	test("writes release.json and its signature", async () => {
		const release = await built();
		const text = readFileSync(join(out, "release.json"), "utf-8");
		expect(text).toBe(renderRelease(release));
		const sig = readFileSync(join(out, "release.json.sig"), "utf-8").trim();
		expect(
			verifySignature(new TextEncoder().encode(text), sig, keys.publicPem),
		).toBe(true);
		expect(checkRelease(release, readFrom(out), keys.publicPem).ok).toBe(true);
	});

	test("is publishable only as a dry run, with uniquely named assets", async () => {
		const release = await built();
		const plan = preparePublish(release, readFrom(out), keys.publicPem, {
			dryRun: true,
			npm: true,
		});
		expect(plan.ok).toBe(true);
		if (plan.ok) {
			for (const asset of plan.value.assets) {
				expect(existsSync(join(out, asset))).toBe(true);
			}
		}
		expect(
			preparePublish(release, readFrom(out), keys.publicPem, {
				dryRun: false,
				npm: false,
			}),
		).toEqual({ ok: false, error: { kind: "dry_run_release" } });
	});

	test("signs the runtime manifest the launchers check", async () => {
		await built();
		const manifest = JSON.parse(
			readFileSync(join(out, "runtime", "manifest.json"), "utf-8"),
		) as {
			version: string;
			artifacts: Record<string, { url: string; signature: string }>;
		};
		expect(manifest.version).toBe(VERSION);
		expect(Object.keys(manifest.artifacts)).toEqual([...TARGETS]);
		for (const target of TARGETS) {
			const entry = manifest.artifacts[target];
			const bytes = new Uint8Array(
				readFileSync(join(out, "runtime", artifactName(VERSION, target))),
			);
			expect(entry?.url).toEndWith(
				`/runtime-v${VERSION}/${artifactName(VERSION, target)}`,
			);
			expect(
				verifySignature(bytes, entry?.signature ?? "", keys.publicPem),
			).toBe(true);
		}
	});

	test("packs each plugin at the release version, launcher executable", async () => {
		const release = await built();
		for (const a of release.artifacts.filter((x) => x.kind === "plugin")) {
			const entries = untarGz(new Uint8Array(readFileSync(join(out, a.file))));
			expect(entries.ok).toBe(true);
			if (!entries.ok) continue;
			const byPath = new Map(entries.value.map((e) => [e.path, e]));
			const manifest = [...byPath.keys()].find((p) =>
				p.endsWith("plugin.json"),
			);
			expect(manifest).toBeDefined();
			const text = new TextDecoder().decode(
				byPath.get(manifest ?? "")?.content,
			);
			expect(JSON.parse(text).version).toBe(VERSION);
			expect(byPath.get("launcher/launch.sh")?.executable).toBe(true);
			expect(
				new TextDecoder().decode(
					byPath.get("launcher/release.pub.pem")?.content,
				),
			).toBe(keys.publicPem);
			const launcherManifest = new TextDecoder().decode(
				byPath.get("launcher/manifest.json")?.content,
			);
			expect(launcherManifest).toBe(
				readFileSync(join(out, "runtime", "manifest.json"), "utf-8"),
			);
		}
	});

	test("writes the marketplace bump as a tree of repo files", async () => {
		await built();
		const tree = join(out, "marketplaces");
		for (const m of MARKETPLACES) {
			expect(existsSync(join(tree, m.listing))).toBe(true);
		}
		const launcher = JSON.parse(
			readFileSync(
				join(tree, "packages", "runtime", "launcher", "manifest.json"),
				"utf-8",
			),
		);
		expect(launcher.version).toBe(VERSION);
		const claude = JSON.parse(
			readFileSync(
				join(tree, "packages/plugins/dist/claude/.claude-plugin/plugin.json"),
				"utf-8",
			),
		);
		expect(claude.version).toBe(VERSION);
	});
});

describe("dry-run release fails when anything is missing", () => {
	test("a runtime target that does not compile", async () => {
		const result = await dryRun(ports({ failTarget: "windows-x64" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toEqual({
				kind: "compile_failed",
				target: "windows-x64",
				message: "cannot compile windows-x64",
			});
		}
		expect(existsSync(join(out, "release.json"))).toBe(false);
	});

	test("a CLI package at another version", async () => {
		const result = await dryRun(ports({ skew: { "@mainahq/mcp": "0.0.1" } }));
		expect(result.ok).toBe(false);
		if (!result.ok && result.error.kind === "check_failed") {
			expect(describeProblems(result.error.problems)).toContain(
				`npm @mainahq/mcp: version 0.0.1, expected ${VERSION}`,
			);
		} else {
			throw new Error(`expected check_failed, got ${JSON.stringify(result)}`);
		}
		expect(existsSync(join(out, "release.json"))).toBe(false);
	});

	test("an artifact removed after the build", async () => {
		const release = await built();
		const plugin = release.artifacts.find((a) => a.id === "agent-plugins");
		rmSync(join(out, plugin?.file ?? "missing"));
		const result = checkRelease(release, readFrom(out), keys.publicPem);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(describeProblems(result.error)).toContain(
				`plugin agent-plugins: file ${plugin?.file} is missing`,
			);
		}
	});
});
