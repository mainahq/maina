/**
 * `maina cloud enrol | status | logout | privacy` (#589, spec §6.3,
 * FR-ID-6, FR-PRIV-3). Runs against the Link fake cloud; the last suite
 * bundles the command for Node and runs it with a real `node` against the
 * fake cloud served over HTTP (v1 constraint: the CLI runs under Node).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type FakeCloud,
	fakeCloud,
} from "@mainahq/runtime/src/link/__tests__/fake-cloud";
import { createLinkClient } from "@mainahq/runtime/src/link/client";
import { nodeLinkCrypto } from "@mainahq/runtime/src/link/keys";
import { createPolicySync } from "@mainahq/runtime/src/link/policy-sync";
import privacy from "@mainahq/runtime/src/link/protocol/v1/privacy.json" with {
	type: "json",
};
import { fileLinkStore } from "@mainahq/runtime/src/link/store";
import { type CloudPorts, runCloud } from "../cloud";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "maina-cloud-cmd-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse("2026-09-28T09:00:00.000Z");

type Harness = { ports: CloudPorts; out: string[]; err: string[] };

function harness(cloud: FakeCloud, env: Record<string, string> = {}): Harness {
	const out: string[] = [];
	const err: string[] = [];
	return {
		out,
		err,
		ports: {
			link: {
				http: cloud.http,
				store: fileLinkStore(join(dir, "link")),
				crypto: nodeLinkCrypto,
				clock: () => new Date(NOW),
				sleep: async () => {},
			},
			env: {
				get: (name) => ({ MAINA_CLOUD_URL: cloud.baseUrl, ...env })[name],
			},
			device: { os: "darwin", arch: "arm64", runtimeVersion: "1.8.1" },
			stdout: (t) => out.push(t),
			stderr: (t) => err.push(t),
		},
	};
}

const text = (lines: string[]) => lines.join("");

function privateSeeds(): string[] {
	const pem = readFileSync(join(dir, "link", "device.key"), "utf-8");
	const body = pem
		.split("\n")
		.filter((l) => l !== "" && !l.startsWith("-----"))
		.join("");
	const der = Buffer.from(body, "base64");
	const seed = der.subarray(der.length - 32);
	return [body, seed.toString("base64url"), seed.toString("hex")];
}

describe("maina cloud enrol", () => {
	test("shows the user code, waits for the approval and names the org", async () => {
		const cloud = fakeCloud({ pendingPolls: 1 });
		const h = harness(cloud);
		expect(await runCloud(["enrol"], h.ports)).toBe(0);
		const out = text(h.out);
		expect(out).toContain("WDJB-MJHT");
		expect(out).toContain("https://app.cloud.test/enrol");
		expect(out).toContain("dev_01J9Z3K4T8QX");
		expect(out).toContain("org_acme");
		for (const secret of privateSeeds()) {
			expect(out).not.toContain(secret);
			expect(text(h.err)).not.toContain(secret);
		}
	});

	test("--ci reads the scoped token from MAINA_LINK_CI_TOKEN, never from argv", async () => {
		const cloud = fakeCloud({ ciToken: "mat_ci_token_abcdefghijklmnop" });
		const missing = harness(cloud);
		expect(await runCloud(["enrol", "--ci"], missing.ports)).toBe(1);
		expect(text(missing.err)).toContain("MAINA_LINK_CI_TOKEN");
		expect(cloud.requests).toEqual([]);

		const h = harness(cloud, {
			MAINA_LINK_CI_TOKEN: "mat_ci_token_abcdefghijklmnop",
		});
		expect(await runCloud(["enrol", "--ci"], h.ports)).toBe(0);
		expect(text(h.out)).not.toContain("WDJB-MJHT");
		expect(text(h.out)).not.toContain("mat_ci_token_abcdefghijklmnop");
	});

	test("a refusal exits 1 with the cloud's code", async () => {
		const cloud = fakeCloud({ refuseCompleteWith: "expired_code" });
		const h = harness(cloud);
		expect(await runCloud(["enrol"], h.ports)).toBe(1);
		expect(text(h.err)).toContain("expired_code");
	});
});

describe("maina cloud status", () => {
	test("not enrolled", async () => {
		const h = harness(fakeCloud());
		expect(await runCloud(["status"], h.ports)).toBe(0);
		expect(text(h.out)).toContain("not enrolled");
		const j = harness(fakeCloud());
		expect(await runCloud(["status", "--json"], j.ports)).toBe(0);
		expect(JSON.parse(text(j.out))).toEqual({ kind: "not_enrolled" });
	});

	test("enrolled: device, org, cloud, pinned keys; never the salt or a key", async () => {
		const cloud = fakeCloud();
		const h = harness(cloud);
		await runCloud(["enrol"], h.ports);
		const s = harness(cloud);
		expect(await runCloud(["status"], s.ports)).toBe(0);
		const out = text(s.out);
		expect(out).toContain("enrolled");
		expect(out).toContain("dev_01J9Z3K4T8QX");
		expect(out).toContain("org_acme");
		expect(out).toContain("https://cloud.test");
		const salt = JSON.parse(
			readFileSync(join(dir, "link", "device.json"), "utf-8"),
		).enrolment.linkSalt.value;
		expect(out).not.toContain(salt);
		for (const secret of privateSeeds()) expect(out).not.toContain(secret);
		const j = harness(cloud);
		await runCloud(["status", "--json"], j.ports);
		const json = JSON.parse(text(j.out));
		expect(json).toMatchObject({
			kind: "enrolled",
			deviceId: "dev_01J9Z3K4T8QX",
			orgId: "org_acme",
			dataClass: "metadata",
		});
		expect(JSON.stringify(json)).not.toContain(salt);
	});

	// #592: the managed policy the device holds, and whether it is signed.
	test("shows the held managed policy, and a refused unsigned one", async () => {
		const cloud = fakeCloud();
		const h = harness(cloud);
		await runCloud(["enrol"], h.ports);
		const none = harness(cloud);
		await runCloud(["status"], none.ports);
		expect(text(none.out)).toContain("policy:     none held yet");

		// The dark signer's bundle is refused (adr/0012 §6), never held.
		cloud.state.policy = cloud.policyBundle(
			3,
			{ version: 1, action_classes: { deploy: { verdict: "deny" } } },
			{ signed: false },
		);
		await createPolicySync(h.ports.link).tick();
		const s = harness(cloud);
		expect(await runCloud(["status"], s.ports)).toBe(0);
		expect(text(s.out)).toContain(
			"policy:     none held yet; the last bundle (v3) was refused (unsigned)",
		);
		const j = harness(cloud);
		await runCloud(["status", "--json"], j.ports);
		expect(JSON.parse(text(j.out)).policy).toMatchObject({
			kind: "none",
			lastRefusal: { kind: "unsigned", version: 3 },
		});

		cloud.state.policy = cloud.policyBundle(4, {
			version: 1,
			action_classes: { deploy: { verdict: "deny" } },
		});
		await createPolicySync(h.ports.link).tick();
		const signed = harness(cloud);
		await runCloud(["status"], signed.ports);
		expect(text(signed.out)).toContain(
			"policy:     v4 signed (key key_policy_1)",
		);
	});

	test("a device_revoked answer shows as revoked, with the way back", async () => {
		const cloud = fakeCloud();
		const h = harness(cloud);
		await runCloud(["enrol"], h.ports);
		cloud.state.revoked = true;
		const sent = await createLinkClient(h.ports.link).send({
			method: "POST",
			path: "/link/v1/events",
			body: {},
		});
		expect(sent.ok).toBe(false);
		const s = harness(cloud);
		expect(await runCloud(["status"], s.ports)).toBe(0);
		const out = text(s.out);
		expect(out).toContain("revoked");
		expect(out).toContain("maina cloud enrol");
	});

	test("--check asks the cloud and records a revocation", async () => {
		const cloud = fakeCloud();
		const h = harness(cloud);
		await runCloud(["enrol"], h.ports);
		const live = harness(cloud);
		expect(await runCloud(["status", "--check"], live.ports)).toBe(0);
		expect(text(live.out)).toContain("token exchange ok");
		cloud.state.revoked = true;
		const s = harness(cloud);
		expect(await runCloud(["status", "--check"], s.ports)).toBe(1);
		expect(text(s.out)).toContain("revoked");
		// Plain status stays informational: it reports, it does not fail.
		const plain = harness(cloud);
		expect(await runCloud(["status"], plain.ports)).toBe(0);
	});

	test("--check exits 1 when the device cannot get a token", async () => {
		const cloud = fakeCloud();
		// Not enrolled: nothing to check with.
		const none = harness(cloud);
		expect(await runCloud(["status", "--check"], none.ports)).toBe(1);
		expect(await runCloud(["status", "--check", "--json"], none.ports)).toBe(1);
		// Enrolled, but the cloud is unreachable.
		await runCloud(["enrol"], harness(cloud).ports);
		const down = harness(cloud);
		const offline: CloudPorts = {
			...down.ports,
			link: {
				...down.ports.link,
				http: {
					request: async () => ({
						ok: false,
						error: { kind: "network", url: cloud.baseUrl, message: "down" },
					}),
				},
			},
		};
		expect(await runCloud(["status", "--check"], offline)).toBe(1);
		expect(text(down.out)).toContain("cannot reach the cloud");
	});
});

describe("maina cloud logout", () => {
	test("forgets the device key and enrolment", async () => {
		const cloud = fakeCloud();
		const h = harness(cloud);
		await runCloud(["enrol"], h.ports);
		const l = harness(cloud);
		expect(await runCloud(["logout"], l.ports)).toBe(0);
		expect(text(l.out)).toContain("dev_01J9Z3K4T8QX");
		const s = harness(cloud);
		await runCloud(["status"], s.ports);
		expect(text(s.out)).toContain("not enrolled");
		// `unenrol` is the same command.
		const u = harness(cloud);
		expect(await runCloud(["unenrol"], u.ports)).toBe(0);
		expect(text(u.out)).toContain("not enrolled");
	});
});

describe("maina cloud privacy", () => {
	type Field = { field: string; kind: string; required: boolean };
	type ClassEntry = {
		messages: Record<string, Field[]>;
		events: Record<string, Field[]>;
	};
	const classes = privacy.classes as unknown as Record<string, ClassEntry>;
	const descriptions = privacy.dataClasses as Record<string, string>;

	for (const dataClass of Object.keys(classes)) {
		test(`--json equals privacy.json for ${dataClass}`, async () => {
			const h = harness(fakeCloud());
			expect(
				await runCloud(["privacy", "--class", dataClass, "--json"], h.ports),
			).toBe(0);
			const printed = JSON.parse(text(h.out));
			expect(printed.dataClass).toBe(dataClass);
			expect(printed.description).toBe(descriptions[dataClass]);
			expect(printed.messages).toEqual(classes[dataClass]?.messages);
			expect(printed.events).toEqual(classes[dataClass]?.events);
			expect(printed.salts).toEqual(privacy.salts);
		});

		test(`the text lists every field sent at ${dataClass}, and nothing else`, async () => {
			const h = harness(fakeCloud());
			expect(await runCloud(["privacy", "--class", dataClass], h.ports)).toBe(
				0,
			);
			const out = text(h.out);
			expect(out).toContain(descriptions[dataClass] ?? "?");
			const entry = classes[dataClass] as ClassEntry;
			const expected: string[] = [];
			for (const [group, byName] of [
				["message", entry.messages],
				["event", entry.events],
			] as const) {
				for (const [name, fields] of Object.entries(byName)) {
					for (const f of fields) {
						expected.push(
							`${group} ${name} ${f.field} ${f.kind} ${f.required ? "required" : "optional"}`,
						);
					}
				}
			}
			const printed = out
				.split("\n")
				.filter((l) => /^\s{4}\S/.test(l))
				.map((l) => l.trim().split(/\s+/));
			// Each field line reads "<field> <kind> <required|optional>" under a
			// "  <group> <name>" heading; rebuild the tuples in order.
			const tuples: string[] = [];
			let heading = "";
			for (const line of out.split("\n")) {
				if (/^ {2}(message|event) \S+$/.test(line)) heading = line.trim();
				else if (/^ {4}\S/.test(line)) {
					tuples.push(`${heading} ${line.trim().split(/\s+/).join(" ")}`);
				}
			}
			expect(printed.length).toBe(expected.length);
			expect(tuples).toEqual(expected);
		});
	}

	test("defaults to the device's data class, metadata before any policy", async () => {
		const h = harness(fakeCloud());
		expect(await runCloud(["privacy", "--json"], h.ports)).toBe(0);
		expect(JSON.parse(text(h.out)).dataClass).toBe("metadata");
	});

	// #644: the class the org told the device at enrolment, not a guess.
	test("shows the org's data class the device was enrolled with", async () => {
		const cloud = fakeCloud({ orgDataClass: "rich" });
		const e = harness(cloud);
		expect(await runCloud(["enrol"], e.ports)).toBe(0);
		const h = harness(cloud);
		expect(await runCloud(["privacy", "--json"], h.ports)).toBe(0);
		expect(JSON.parse(text(h.out)).dataClass).toBe("rich");
		const s = harness(cloud);
		expect(await runCloud(["status"], s.ports)).toBe(0);
		expect(text(s.out)).toContain("data class: rich");
	});

	test("an unknown class is a usage error", async () => {
		const h = harness(fakeCloud());
		expect(await runCloud(["privacy", "--class", "everything"], h.ports)).toBe(
			64,
		);
	});
});

test("an unknown subcommand prints the usage and exits 64", async () => {
	const h = harness(fakeCloud());
	expect(await runCloud(["frobnicate"], h.ports)).toBe(64);
	expect(text(h.err)).toContain("maina cloud enrol");
	const help = harness(fakeCloud());
	expect(await runCloud(["--help"], help.ports)).toBe(0);
	expect(text(help.out)).toContain("maina cloud privacy");
});

// ── Node build ─────────────────────────────────────────────────────────────

/** A Node >= 20 binary (not Bun's `node` shim), or null when absent. */
function findNode(): string | null {
	const node = Bun.which("node");
	if (node === null) return null;
	const proc = Bun.spawnSync([node, "-p", "process.versions.node"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = proc.stdout.toString();
	if (proc.exitCode !== 0 || out.includes("bun")) return null;
	const major = Number(out.split(".")[0] ?? "0");
	return major >= 20 ? realpathSync(node) : null;
}

const node = findNode();

describe.skipIf(node === null)("maina cloud under the Node build", () => {
	test("enrol, status, privacy and logout run under Node against a cloud over HTTP", async () => {
		const cloud = fakeCloud({ ciToken: "mat_ci_token_abcdefghijklmnop" });
		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: async (req) => {
				const url = new URL(req.url);
				const headers: Record<string, string> = {};
				req.headers.forEach((v, k) => {
					headers[k === "authorization" ? "Authorization" : k] = v;
				});
				const res = cloud.handle({
					method: req.method,
					url: `${cloud.baseUrl}${url.pathname}`,
					headers,
					body: await req.text(),
				});
				return new Response(res.body, {
					status: res.status,
					headers: { "content-type": "application/json" },
				});
			},
		});
		try {
			const out = join(dir, "node-build");
			const built = await Bun.build({
				entrypoints: [join(import.meta.dir, "fixtures", "cloud-node.ts")],
				outdir: out,
				target: "node",
				format: "esm",
			});
			expect(built.success).toBe(true);
			const bundle = built.outputs[0]?.path ?? "";
			const env = {
				PATH: "/usr/bin:/bin",
				HOME: dir,
				MAINA_LINK_DIR: join(dir, "node-link"),
				MAINA_CLOUD_URL: `http://127.0.0.1:${server.port}`,
				MAINA_LINK_CI_TOKEN: "mat_ci_token_abcdefghijklmnop",
			};
			const run = async (args: string[]) => {
				const proc = Bun.spawn([node as string, bundle, ...args], {
					env,
					stdout: "pipe",
					stderr: "pipe",
				});
				const [stdout, stderr, code] = await Promise.all([
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
					proc.exited,
				]);
				return { stdout, stderr, code };
			};
			const enrol = await run(["cloud", "enrol", "--ci"]);
			expect(enrol.stderr).toBe("");
			expect(enrol.code).toBe(0);
			expect(enrol.stdout).toContain("dev_01J9Z3K4T8QX");
			expect(cloud.state.proofVerified).toBe(true);

			const status = await run(["cloud", "status", "--json", "--check"]);
			expect(status.code).toBe(0);
			expect(JSON.parse(status.stdout.split("\n")[0] ?? "{}")).toMatchObject({
				kind: "enrolled",
				deviceId: "dev_01J9Z3K4T8QX",
			});
			expect(cloud.state.challengesVerified).toBe(1);

			const priv = await run(["cloud", "privacy", "--json"]);
			expect(priv.code).toBe(0);
			expect(JSON.parse(priv.stdout).messages).toEqual(
				privacy.classes.metadata.messages,
			);

			const logout = await run(["cloud", "logout"]);
			expect(logout.code).toBe(0);
			const after = await run(["cloud", "status", "--json"]);
			expect(JSON.parse(after.stdout)).toEqual({ kind: "not_enrolled" });
		} finally {
			server.stop(true);
		}
	}, 60_000);
});
