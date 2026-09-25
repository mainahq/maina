/**
 * Single version source (#294, FR-INS-2).
 *
 * `VERSION`, exported from `@mainahq/core`, is the only place the runtime
 * reads its version. `scripts/version-source.ts` generates it from the
 * version `changeset version` writes into the package manifests, so a
 * release can never ship a CLI, MCP server and core that disagree.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { VERSION } from "../../packages/core/src/index";
import {
	checkVersionModule,
	renderVersionModule,
	VERSION_MODULE,
	versionFromManifest,
} from "../version-source";

const ROOT = resolve(import.meta.dir, "..", "..");
const PUBLISHED = ["core", "cli", "mcp"] as const;

function manifestVersion(pkg: string): string {
	const raw = readFileSync(
		join(ROOT, "packages", pkg, "package.json"),
		"utf-8",
	);
	return (JSON.parse(raw) as { version: string }).version;
}

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name === "__tests__" || name === "__golden__") continue;
			out.push(...sourceFiles(path));
		} else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
			out.push(path);
		}
	}
	return out;
}

describe("renderVersionModule", () => {
	test("emits a VERSION constant for a release version", () => {
		const r = renderVersionModule("2.0.0");
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value).toContain('export const VERSION = "2.0.0";');
		expect(r.value).toContain("scripts/version-source.ts");
	});

	test("accepts prerelease and snapshot versions", () => {
		for (const v of ["2.0.0-rc.1", "0.0.0-canary-20260925"]) {
			const r = renderVersionModule(v);
			expect(r.ok && r.value).toContain(`export const VERSION = "${v}";`);
		}
	});

	test("rejects a value that is not a semver version", () => {
		for (const v of ["", "latest", "1.2", 'x"; process.exit(1); "']) {
			expect(renderVersionModule(v).ok).toBe(false);
		}
	});
});

describe("versionFromManifest", () => {
	test("reads the version field", () => {
		expect(
			versionFromManifest('{"name":"@mainahq/core","version":"1.2.3"}'),
		).toEqual({ ok: true, value: "1.2.3" });
	});

	test("reports a manifest without a version", () => {
		expect(versionFromManifest('{"name":"x"}').ok).toBe(false);
		expect(versionFromManifest("{ nope").ok).toBe(false);
	});
});

describe("checkVersionModule", () => {
	test("passes when the generated module is current", () => {
		const r = renderVersionModule("1.2.3");
		if (!r.ok) throw new Error(r.error);
		expect(checkVersionModule(r.value, "1.2.3")).toEqual({
			ok: true,
			value: undefined,
		});
	});

	test("fails when the module is stale or missing", () => {
		const r = renderVersionModule("1.2.3");
		if (!r.ok) throw new Error(r.error);
		expect(checkVersionModule(r.value, "1.2.4").ok).toBe(false);
		expect(checkVersionModule(null, "1.2.3").ok).toBe(false);
	});
});

describe("VERSION", () => {
	test("the committed module is what the generator writes for the changeset version", () => {
		const committed = readFileSync(join(ROOT, VERSION_MODULE), "utf-8");
		expect(checkVersionModule(committed, manifestVersion("core"))).toEqual({
			ok: true,
			value: undefined,
		});
	});

	test("matches the changeset version of every published package", () => {
		for (const pkg of PUBLISHED) {
			expect({ pkg, version: manifestVersion(pkg) }).toEqual({
				pkg,
				version: VERSION,
			});
		}
	});

	test("changesets versions cli, core and mcp as one fixed group", () => {
		const config = JSON.parse(
			readFileSync(join(ROOT, ".changeset", "config.json"), "utf-8"),
		) as { fixed?: string[][]; linked?: string[][] };
		const group = (config.fixed ?? []).find((g) => g.includes("@mainahq/cli"));
		expect(group).toBeDefined();
		for (const pkg of PUBLISHED) expect(group).toContain(`@mainahq/${pkg}`);
		for (const g of config.linked ?? []) {
			for (const pkg of PUBLISHED) expect(g).not.toContain(`@mainahq/${pkg}`);
		}
	});

	test("`bun run version` regenerates the module after changeset version", () => {
		const root = JSON.parse(
			readFileSync(join(ROOT, "package.json"), "utf-8"),
		) as { scripts: Record<string, string> };
		expect(root.scripts.version).toMatch(
			/^changeset version && bun scripts\/version-source\.ts$/,
		);
	});

	test("no runtime source reads a package manifest for its version", () => {
		const offenders: string[] = [];
		for (const pkg of PUBLISHED) {
			for (const file of sourceFiles(join(ROOT, "packages", pkg, "src"))) {
				const text = readFileSync(file, "utf-8");
				if (
					/import\s+\w+\s+from\s+["'](\.\.\/)+package\.json["']/.test(text) ||
					/name:\s*["']maina["'],\s*version:\s*["']\d/.test(text)
				) {
					offenders.push(relative(ROOT, file));
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("`--check` exits 0 on a clean tree", () => {
		const proc = Bun.spawnSync(
			["bun", join(ROOT, "scripts", "version-source.ts"), "--check"],
			{ cwd: ROOT, stdout: "pipe", stderr: "pipe" },
		);
		expect({
			exitCode: proc.exitCode,
			stderr: proc.stderr.toString(),
		}).toEqual({ exitCode: 0, stderr: "" });
	});
});
