/**
 * `maina model status|pull|verify` (#338): the local System 1 model.
 *
 * The runtime owns the model (download, verification, engines), so the
 * command is a formatter over ports the runtime supplies, like the status
 * line. `status` always exits 0; `pull` and `verify` exit 1 when the model
 * is not installed and verified.
 */

import { describe, expect, test } from "bun:test";
import { type ModelCommandPorts, type ModelStatus, runModel } from "../model";

type Fake = Readonly<{
	ports: ModelCommandPorts;
	out: string[];
	err: string[];
}>;

const VERIFIED: ModelStatus = {
	name: "maina-system1",
	version: "0.3.0",
	dir: "/cache/models/maina-system1/0.3.0",
	target: "darwin-arm64",
	state: { kind: "verified" },
	engine: { engine: "native", shadowOnly: false, notice: undefined },
};

function fake(overrides: Partial<ModelCommandPorts> = {}): Fake {
	const out: string[] = [];
	const err: string[] = [];
	return {
		out,
		err,
		ports: {
			status: async () => VERIFIED,
			pull: async () => ({
				ok: true,
				value: { dir: VERIFIED.dir ?? "", version: "0.3.0", downloaded: true },
			}),
			verify: async () => ({
				ok: true,
				value: { dir: VERIFIED.dir ?? "", version: "0.3.0" },
			}),
			stdout: (t) => out.push(t),
			stderr: (t) => err.push(t),
			...overrides,
		},
	};
}

describe("maina model status", () => {
	test("shows the pinned release, its cache and that it verified", async () => {
		const f = fake();
		expect(await runModel(["status"], f.ports)).toBe(0);
		const text = f.out.join("");
		expect(text).toContain("maina-system1 0.3.0");
		expect(text).toContain("/cache/models/maina-system1/0.3.0");
		expect(text).toContain("verified");
		expect(text).toContain("native");
	});

	test("says how to install a release that was never pulled", async () => {
		const f = fake({
			status: async () => ({
				...VERIFIED,
				state: { kind: "not_installed" },
				engine: undefined,
			}),
		});
		expect(await runModel(["status"], f.ports)).toBe(0);
		expect(f.out.join("")).toContain("maina model pull");
	});

	test("shows why a cached release failed verification", async () => {
		const f = fake({
			status: async () => ({
				...VERIFIED,
				state: {
					kind: "unverified",
					message:
						"model 0.3.0 failed verification (model int8: sha256 mismatch)",
				},
			}),
		});
		expect(await runModel(["status"], f.ports)).toBe(0);
		expect(f.out.join("")).toContain("model int8: sha256 mismatch");
	});

	test("says when no release is pinned", async () => {
		const f = fake({
			status: async () => ({
				...VERIFIED,
				version: null,
				dir: null,
				state: { kind: "unpinned" },
				engine: undefined,
			}),
		});
		expect(await runModel(["status"], f.ports)).toBe(0);
		expect(f.out.join("")).toContain("no release is pinned");
	});

	test("shows a WASM-only target as shadow only, with its notice", async () => {
		const f = fake({
			status: async () => ({
				...VERIFIED,
				target: "linux-x64-musl",
				engine: {
					engine: "wasm",
					shadowOnly: true,
					notice: "system1: runs in shadow only",
				},
			}),
		});
		await runModel(["status"], f.ports);
		expect(f.out.join("")).toContain("shadow only");
	});

	test("--json prints the status as one JSON object", async () => {
		const f = fake();
		expect(await runModel(["status", "--json"], f.ports)).toBe(0);
		expect(JSON.parse(f.out.join(""))).toEqual(
			JSON.parse(JSON.stringify(VERIFIED)),
		);
	});
});

describe("maina model pull", () => {
	test("downloads and verifies the pinned release", async () => {
		const f = fake();
		expect(await runModel(["pull"], f.ports)).toBe(0);
		expect(f.out.join("")).toContain("downloaded and verified");
	});

	test("an installed release is not downloaded again", async () => {
		const f = fake({
			pull: async () => ({
				ok: true,
				value: { dir: "/d", version: "0.3.0", downloaded: false },
			}),
		});
		expect(await runModel(["pull"], f.ports)).toBe(0);
		expect(f.out.join("")).toContain("already installed");
	});

	test("a failed pull exits 1 with the reason", async () => {
		const f = fake({
			pull: async () => ({
				ok: false,
				error: {
					message:
						"model 0.3.0 failed verification (model int8: bad signature)",
				},
			}),
		});
		expect(await runModel(["pull"], f.ports)).toBe(1);
		expect(f.err.join("")).toContain("bad signature");
	});
});

describe("maina model verify", () => {
	test("re-verifies the cached release", async () => {
		const f = fake();
		expect(await runModel(["verify"], f.ports)).toBe(0);
		expect(f.out.join("")).toContain("verified");
	});

	test("a tampered cache exits 1 with the reason", async () => {
		const f = fake({
			verify: async () => ({
				ok: false,
				error: {
					message:
						"model 0.3.0 failed verification (tokenizer: sha256 mismatch)",
				},
			}),
		});
		expect(await runModel(["verify"], f.ports)).toBe(1);
		expect(f.err.join("")).toContain("tokenizer: sha256 mismatch");
	});
});

describe("usage", () => {
	test("no subcommand, or an unknown one, prints the usage and exits 64", async () => {
		for (const args of [[], ["frobnicate"], ["pull", "extra"]]) {
			const f = fake();
			expect(await runModel(args, f.ports)).toBe(64);
			expect(f.err.join("")).toContain("usage: maina model");
		}
	});

	test("--help prints the usage and exits 0", async () => {
		const f = fake();
		expect(await runModel(["--help"], f.ports)).toBe(0);
		expect(f.out.join("")).toContain("usage: maina model");
	});
});
