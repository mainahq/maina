/**
 * Compiled packages (#294, FR-INS-1, fixes P2/P3).
 *
 * What npm users get is what `npm pack` produces, so this test packs the
 * real packages and installs the tarballs into a throwaway directory:
 *
 *   - no package ships TypeScript sources (only `.d.ts` declarations);
 *   - the installed `maina` bin runs `--version` under Node >= 20 with no
 *     Bun anywhere on PATH (the old `#!/usr/bin/env bun` shebang and raw
 *     `.ts` entry points made that exit 127);
 *   - the version it prints is `VERSION` from core.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { VERSION } from "@mainahq/core";

const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const PACKAGES = ["core", "mcp", "cli"] as const;
type Pkg = (typeof PACKAGES)[number];

interface PackEntry {
	readonly filename: string;
	readonly files: readonly { readonly path: string }[];
}

/** A Node >= 20 binary (not Bun's `node` shim), or null when absent. */
function findNode(): string | null {
	const node = Bun.which("node");
	if (node === null) return null;
	const proc = Bun.spawnSync([node, "-p", "process.versions"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = proc.stdout.toString();
	if (proc.exitCode !== 0 || out.includes("bun")) return null;
	const major = Number(/node: '(\d+)/.exec(out)?.[1] ?? "0");
	return major >= 20 ? realpathSync(node) : null;
}

const node = findNode();
const npm = Bun.which("npm");
const work = mkdtempSync(join(tmpdir(), "maina-packed-install-"));
const packs = new Map<Pkg, PackEntry>();

function run(
	argv: readonly string[],
	cwd: string,
	env: Record<string, string | undefined> = process.env,
): { exitCode: number; stdout: string; stderr: string } {
	const proc = Bun.spawnSync([...argv], {
		cwd,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: proc.exitCode ?? -1,
		stdout: proc.stdout.toString(),
		stderr: proc.stderr.toString(),
	};
}

function mustRun(
	argv: readonly string[],
	cwd: string,
	env: Record<string, string | undefined> = process.env,
): string {
	const r = run(argv, cwd, env);
	if (r.exitCode !== 0) {
		// bunup reports build errors on stdout, so show both streams.
		throw new Error(
			`${argv.join(" ")} (in ${cwd}) failed:\n${r.stdout}\n${r.stderr}`,
		);
	}
	return r.stdout;
}

beforeAll(() => {
	if (npm === null) return;
	for (const pkg of PACKAGES) {
		const dir = join(ROOT, "packages", pkg);
		// Same as the release (`bun run build` at the root): build what has a
		// build, then pack exactly what `npm publish` would upload.
		const scripts = (
			JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
				scripts?: Record<string, string>;
			}
		).scripts;
		// `CI=true` as in the release job: bunup then fails the build on
		// declaration errors it only warns about locally.
		if (scripts?.build !== undefined) {
			mustRun(["bun", "run", "build"], dir, { ...process.env, CI: "true" });
		}
		const out = mustRun(
			[npm, "pack", "--json", "--pack-destination", work],
			dir,
		);
		const [entry] = JSON.parse(out) as PackEntry[];
		if (entry === undefined) throw new Error(`npm pack ${pkg}: no output`);
		packs.set(pkg, entry);
	}
}, 300_000);

afterAll(() => {
	rmSync(work, { recursive: true, force: true });
});

describe.skipIf(npm === null)("npm pack", () => {
	for (const pkg of PACKAGES) {
		test(`@mainahq/${pkg} ships no TypeScript sources except .d.ts`, () => {
			const files = packs.get(pkg)?.files.map((f) => f.path) ?? [];
			expect(files.length).toBeGreaterThan(0);
			const sources = files.filter(
				(f) => /\.(c|m)?tsx?$/.test(f) && !/\.d\.(c|m)?ts$/.test(f),
			);
			expect(sources).toEqual([]);
		});

		test(`@mainahq/${pkg} declarations keep every exported type`, () => {
			// Isolated-declaration fallbacks emit `declare const x: unknown;`,
			// which silently strips the type from consumers.
			const types = join(ROOT, "packages", pkg, "dist", "index.d.ts");
			if (!existsSync(types)) return;
			const text = readFileSync(types, "utf-8");
			expect(text.match(/declare const \w+: unknown;/g) ?? []).toEqual([]);
		});

		test(`@mainahq/${pkg} entry points are compiled files inside the tarball`, () => {
			const files = new Set(packs.get(pkg)?.files.map((f) => f.path) ?? []);
			const manifest = JSON.parse(
				readFileSync(join(ROOT, "packages", pkg, "package.json"), "utf-8"),
			) as {
				main?: string;
				types?: string;
				bin?: Record<string, string>;
			};
			const targets = [
				manifest.main,
				manifest.types,
				...Object.values(manifest.bin ?? {}),
			].filter((t): t is string => t !== undefined);
			expect(targets.length).toBeGreaterThan(0);
			for (const t of targets) {
				const path = t.replace(/^\.\//, "");
				expect({ target: path, packed: files.has(path) }).toEqual({
					target: path,
					packed: true,
				});
				expect(path).toMatch(/\.(js|d\.ts)$/);
			}
		});
	}
});

describe.skipIf(npm === null || node === null)("packed CLI install", () => {
	let prefix = "";
	/** PATH with Node and the system basics, and no Bun anywhere. */
	let nodeOnlyPath = "";

	beforeAll(() => {
		prefix = join(work, "install");
		mkdirSync(prefix, { recursive: true });
		const deps: Record<string, string> = {};
		for (const pkg of PACKAGES) {
			const entry = packs.get(pkg);
			if (entry === undefined) throw new Error(`missing pack for ${pkg}`);
			deps[`@mainahq/${pkg}`] = `file:${join(work, entry.filename)}`;
		}
		// `overrides` points the CLI's own `@mainahq/*` ranges at the tarballs
		// too, so an unpublished version never reaches for the registry.
		writeFileSync(
			join(prefix, "package.json"),
			`${JSON.stringify(
				{
					name: "packed-install",
					private: true,
					dependencies: deps,
					overrides: deps,
				},
				null,
				2,
			)}\n`,
		);
		// Bun only installs (from its warm cache); everything after runs on Node.
		mustRun(["bun", "install", "--no-save"], prefix);

		const bin = join(work, "node-bin");
		mkdirSync(bin, { recursive: true });
		symlinkSync(node as string, join(bin, "node"));
		nodeOnlyPath = [bin, "/usr/bin", "/bin"].join(":");
	}, 300_000);

	test("the sandbox PATH has Node but no Bun", () => {
		const probe = run(["/bin/sh", "-c", "command -v bun"], prefix, {
			PATH: nodeOnlyPath,
		});
		expect(probe.exitCode).not.toBe(0);
		const nodeProbe = run(["/bin/sh", "-c", "command -v node"], prefix, {
			PATH: nodeOnlyPath,
		});
		expect(nodeProbe.exitCode).toBe(0);
	});

	test("installed `maina --version` runs under Node without Bun", () => {
		const maina = join(prefix, "node_modules", ".bin", "maina");
		expect(existsSync(maina)).toBe(true);
		const r = run([maina, "--version"], prefix, {
			PATH: nodeOnlyPath,
			HOME: prefix,
			MAINA_TELEMETRY: "0",
			DO_NOT_TRACK: "1",
		});
		expect({ exitCode: r.exitCode, stderr: r.stderr }).toEqual({
			exitCode: 0,
			stderr: "",
		});
		expect(r.stdout.trim()).toBe(VERSION);
	});

	test("the installed CLI resolves core and mcp from the tarballs, not the checkout", () => {
		const cliEntry = realpathSync(
			join(prefix, "node_modules", "@mainahq", "cli", "package.json"),
		);
		expect(dirname(cliEntry).startsWith(realpathSync(prefix))).toBe(true);
		const core = join(prefix, "node_modules", "@mainahq", "core");
		expect(realpathSync(core).startsWith(realpathSync(prefix))).toBe(true);
		expect(existsSync(join(core, "src"))).toBe(false);
	});

	// A host spawns the runtime by absolute path with a GUI PATH that has no
	// Bun (P2). Cover both runtimes the launcher may write: Bun (the usual
	// case) and Node (a CLI installed and run without Bun).
	test.each([
		["node", () => node as string],
		["bun", () => process.execPath],
	] as const)(
		"the installed MCP server answers initialize with VERSION under %s",
		async (_name, runtime) => {
			const entry = join(
				prefix,
				"node_modules",
				"@mainahq",
				"cli",
				"dist",
				"index.js",
			);
			const proc = Bun.spawn([runtime(), entry, "--mcp"], {
				cwd: prefix,
				env: {
					PATH: nodeOnlyPath,
					HOME: prefix,
					MAINA_TELEMETRY: "0",
					DO_NOT_TRACK: "1",
				},
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			});
			try {
				proc.stdin.write(
					`${JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "initialize",
						params: {
							protocolVersion: "2024-11-05",
							capabilities: {},
							clientInfo: { name: "packed-install-test", version: "0.0.0" },
						},
					})}\n`,
				);
				proc.stdin.flush();
				const decoder = new TextDecoder();
				let buffer = "";
				for await (const chunk of proc.stdout) {
					buffer += decoder.decode(chunk, { stream: true });
					if (buffer.includes("\n")) break;
				}
				const reply = JSON.parse(buffer.split("\n")[0] ?? "") as {
					result?: { serverInfo?: { name?: string; version?: string } };
				};
				expect(reply.result?.serverInfo).toEqual({
					name: "maina",
					version: VERSION,
				});
			} finally {
				proc.kill();
				await proc.exited;
			}
		},
		30_000,
	);
});
