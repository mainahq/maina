/**
 * `index.ts` starts a server only when it is the process entry
 * (`bun packages/mcp/src/index.ts`). Bundled into another entry, such as
 * the standalone runtime (`maina mcp`), every module shares the bundle's
 * path, so a `Bun.main === import.meta.path` check also fired there: a
 * second MCP server, with the default root resolution, answered every
 * request on the same stdio (#344).
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "maina-mcp-entry-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("bundled into another entry, importing the package starts no server", async () => {
	const entry = join(dir, "entry.ts");
	writeFileSync(
		entry,
		[
			`await import(${JSON.stringify(join(import.meta.dir, "..", "index.ts"))});`,
			// startServer marks the process as serving MCP.
			'process.stdout.write(process.env.MAINA_MCP_SERVER ?? "none");',
			"process.exit(0);",
			"",
		].join("\n"),
	);
	// The bundler as the standalone build runs it (`bun build`).
	const build = Bun.spawn(
		[
			process.execPath,
			"build",
			"--target=bun",
			entry,
			"--outdir",
			join(dir, "out"),
		],
		{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
	);
	const [buildErr, buildExit] = await Promise.all([
		new Response(build.stderr).text(),
		build.exited,
	]);
	expect({ buildExit, buildErr }).toEqual({ buildExit: 0, buildErr: "" });
	const proc = Bun.spawn([process.execPath, join(dir, "out", "entry.js")], {
		cwd: dir,
		env: { PATH: process.env.PATH ?? "", HOME: dir },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	expect(exitCode).toBe(0);
	expect(stdout.trim()).toBe("none");
}, 60_000);
