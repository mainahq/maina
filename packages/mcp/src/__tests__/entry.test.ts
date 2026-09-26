/**
 * `index.ts` starts a server only when it is the process entry
 * (`bun packages/mcp/src/index.ts`, or `bun dist/index.js`). Two builds
 * must not start one when the package is merely imported:
 *
 *   - bundled into another entry, such as the standalone runtime
 *     (`maina mcp`), every module shares the bundle's path, so a
 *     `Bun.main === import.meta.path` check alone also fired there: a
 *     second MCP server, with the default root resolution, answered every
 *     request on the same stdio (#344)
 *   - the published build (bunup, `target: "node"`) rewrites
 *     `import.meta.main` to `require.main == require.module`, which is true
 *     under Bun for every importer, so an `import.meta.main` check alone
 *     fired in `maina --mcp`, which imports the published package
 */

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "maina-mcp-entry-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const INDEX = join(import.meta.dir, "..", "index.ts");

/** `bun build` of `entry` into `outdir`, as a build script runs it. */
async function bundle(
	entry: string,
	outdir: string,
	target: "bun" | "node",
): Promise<void> {
	const build = Bun.spawn(
		[
			process.execPath,
			"build",
			`--target=${target}`,
			"--format=esm",
			entry,
			"--outdir",
			outdir,
		],
		{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
	);
	const [buildErr, buildExit] = await Promise.all([
		new Response(build.stderr).text(),
		build.exited,
	]);
	expect({ buildExit, buildErr }).toEqual({ buildExit: 0, buildErr: "" });
}

/** An entry that imports `module` and prints whether a server started. */
function importer(name: string, module: string): string {
	const entry = join(dir, name);
	writeFileSync(
		entry,
		[
			`await import(${JSON.stringify(module)});`,
			// startServer marks the process as serving MCP.
			'process.stdout.write(process.env.MAINA_MCP_SERVER ?? "none");',
			"process.exit(0);",
			"",
		].join("\n"),
	);
	return entry;
}

async function run(
	file: string,
): Promise<{ exitCode: number; stdout: string }> {
	const proc = Bun.spawn([process.execPath, file], {
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
	return { exitCode, stdout: stdout.trim() };
}

test("bundled into another entry, importing the package starts no server", async () => {
	const entry = importer("bundled.ts", INDEX);
	// The bundler as the standalone build runs it.
	await bundle(entry, join(dir, "bundled"), "bun");
	expect(await run(join(dir, "bundled", "bundled.js"))).toEqual({
		exitCode: 0,
		stdout: "none",
	});
}, 60_000);

test("importing the published build from another entry starts no server", async () => {
	// The published build: its own entry, `target: "node"`, as bunup runs it.
	await bundle(INDEX, join(dir, "published"), "node");
	const entry = importer(
		"imports-published.ts",
		join(dir, "published", "index.js"),
	);
	expect(await run(entry)).toEqual({ exitCode: 0, stdout: "none" });
}, 60_000);

test("run directly, the published build serves MCP", async () => {
	await bundle(INDEX, join(dir, "direct"), "node");
	const proc = Bun.spawn([process.execPath, join(dir, "direct", "index.js")], {
		cwd: dir,
		env: { PATH: process.env.PATH ?? "", HOME: dir },
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	proc.stdin.write(
		`${JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: { name: "entry-test", version: "0.0.0" },
			},
		})}\n`,
	);
	proc.stdin.flush();
	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (!buffer.includes("\n")) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
	}
	proc.kill();
	await proc.exited;
	const reply = JSON.parse(buffer.split("\n")[0] ?? "{}") as {
		id?: number;
		result?: { serverInfo?: unknown };
	};
	expect(reply.id).toBe(1);
	expect(reply.result?.serverInfo).toBeDefined();
}, 60_000);
