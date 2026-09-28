/**
 * The compiled runtime carries the release key (#574).
 *
 * `bun build --compile` bundles modules, not the files a module reads at
 * run time, so a key read from disk would be missing, or replaceable, on a
 * user's machine. This compiles a probe over the runtime's key module and
 * runs it from a directory with no checkout, with every plausible key
 * variable pointing at a dev key: it still carries, and checks against, the
 * key the launchers pin.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	devKey,
	signWith,
	utf8,
} from "../../model/__tests__/fixtures/model-release";

const PROBE = join(import.meta.dir, "fixtures", "release-key-probe.ts");
const LAUNCHER_PEM = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"launcher",
	"release.pub.pem",
);

let dir = "";
let probe = "";

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "maina-574-"));
	probe = join(dir, process.platform === "win32" ? "probe.exe" : "probe");
	const build = Bun.spawn(
		[process.execPath, "build", "--compile", PROBE, "--outfile", probe],
		{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
	);
	const [stderr, code] = await Promise.all([
		new Response(build.stderr).text(),
		build.exited,
	]);
	if (code !== 0) throw new Error(`bun build --compile failed: ${stderr}`);
}, 120_000);

afterAll(() => {
	if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("compiled runtime release key", () => {
	test("is the launchers' key, whatever the environment says", async () => {
		const key = devKey();
		const bytes = utf8("maina-system1 manifest");
		const signature = signWith(key.privatePem, bytes);
		const env = {
			PATH: process.env.PATH ?? "",
			HOME: dir,
			MAINA_RELEASE_PUBLIC_KEY: key.publicPem,
			MAINA_MODEL_PUBLIC_KEY: key.publicPem,
			MAINA_MODEL_SIGNING_KEY: key.privatePem,
			MAINA_RUNTIME_SIGNING_KEY: key.privatePem,
		};
		const proc = Bun.spawn(
			[probe, Buffer.from(bytes).toString("base64"), signature],
			{ cwd: dir, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (code !== 0) throw new Error(`probe exited ${code}: ${stderr}`);
		expect(JSON.parse(stdout.trim())).toEqual({
			sha256: createHash("sha256")
				.update(readFileSync(LAUNCHER_PEM, "utf-8"))
				.digest("hex"),
			verified: false,
		});
	}, 30_000);
});
