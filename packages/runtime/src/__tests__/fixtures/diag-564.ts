/**
 * TEMPORARY diagnostic for #564 (removed before merge): spawns the compiled
 * runtime daemon the way `daemonSpawner` does and polls it over its pipe.
 *
 *   bun diag-564.ts <maina executable>
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequest, sendRequest } from "../../ipc";

const [rawBin = "", mode = "detached"] = process.argv.slice(2);
const bin = resolve(rawBin);
const log = (...parts: unknown[]) =>
	process.stderr.write(
		`${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`,
	);
const dir = mkdtempSync(join(tmpdir(), "diag-564-"));
const address =
	process.platform === "win32"
		? `\\\\.\\pipe\\maina-diag-${mode}-${process.pid}`
		: join(dir, "rt.sock");
const status = () =>
	sendRequest(address, createRequest("status", undefined, "0"), 250);

let t = performance.now();
log("absent pipe:", Math.round(performance.now() - t), await status());

const argv = [
	bin,
	"runtime-daemon",
	"--address",
	address,
	"--pid-file",
	join(dir, "rt.pid"),
	"--spawn-lock",
	join(dir, "rt.lock"),
	"--version",
	"0",
	"--idle-ttl-ms",
	"20000",
];
t = performance.now();
const proc =
	mode === "detached"
		? Bun.spawn(argv, {
				cwd: dir,
				detached: true,
				stdio: ["ignore", "ignore", "ignore"],
			})
		: Bun.spawn(argv, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
if (mode === "detached") proc.unref();
log("spawned pid", proc.pid, "in", Math.round(performance.now() - t));
t = performance.now();
for (let i = 0; i < 40; i++) {
	const s = performance.now();
	const r = await status();
	log(
		`poll ${i} at ${Math.round(s - t)} took ${Math.round(performance.now() - s)}:`,
		r,
	);
	if (r.ok) break;
	await Bun.sleep(100);
}
log("exited?", proc.exitCode, proc.signalCode, proc.killed);
if (mode !== "detached") {
	proc.kill();
	log("stderr:", await new Response(proc.stderr as ReadableStream).text());
}
process.exit(0);
