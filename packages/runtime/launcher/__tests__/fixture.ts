/**
 * Fixtures for the launcher tests: a release key pair, a local artifact
 * server, a staged launcher directory and a fake runtime.
 *
 * The manifest and signatures come from the same helpers the release build
 * uses (`build/standalone.ts`), so the tests pin the format the launcher
 * parses to the format the build writes.
 */

import { generateKeyPairSync } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	hostTarget,
	type Manifest,
	publicKeyXml,
	renderManifest,
	sha256Hex,
	signArtifact,
	type Target,
} from "../../build/standalone";

export const LAUNCHER_DIR = join(import.meta.dir, "..");

export const TEST_VERSION = "9.9.9-test";

/** The launcher's minimal environment: what a GUI-launched host passes. */
const MINIMAL_PATH = "/usr/bin:/bin";

/** The artifact target of this machine, as the launcher detects it. */
export function currentTarget(): Target {
	const musl =
		existsSync("/lib/ld-musl-x86_64.so.1") ||
		existsSync("/lib/ld-musl-aarch64.so.1");
	const target = hostTarget(process.platform, process.arch, musl);
	if (target === null) {
		throw new Error(
			`no runtime target for ${process.platform}-${process.arch}`,
		);
	}
	return target;
}

type ReleaseKey = Readonly<{
	privateKeyPem: string;
	publicKeyPem: string;
}>;

export function createReleaseKey(): ReleaseKey {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	return {
		privateKeyPem: privateKey.export({
			type: "pkcs8",
			format: "pem",
		}) as string,
		publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
	};
}

/**
 * A fake runtime: answers an MCP `initialize` in `mcp` mode, prints its
 * umask for `cli umask`, and otherwise echoes the arguments it was started
 * with.
 */
const SHELL_FAKE_RUNTIME = new TextEncoder().encode(
	[
		"#!/bin/sh",
		'case "$1:$2" in',
		"  mcp:*)",
		"    IFS= read -r line",
		`    printf '%s\\n' '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"fake-runtime","version":"0"}}}'`,
		"    cat >/dev/null",
		"    ;;",
		"  cli:umask) umask ;;",
		"  *) printf 'fake-runtime %s\\n' \"$*\" ;;",
		"esac",
		"",
	].join("\n"),
);

/**
 * The fake runtime for this OS: the shell script, or on Windows (where only a
 * real executable can be `maina.exe`) `fixtures/fake-runtime.ts` compiled.
 */
export async function fakeRuntime(): Promise<Uint8Array> {
	if (process.platform !== "win32") return SHELL_FAKE_RUNTIME;
	const outfile = join(
		mkdtempSync(join(tmpdir(), "maina-fake-runtime-")),
		"fake-runtime.exe",
	);
	const proc = Bun.spawn(
		[
			process.execPath,
			"build",
			"--compile",
			join(import.meta.dir, "fixtures", "fake-runtime.ts"),
			"--outfile",
			outfile,
		],
		{ stdio: ["ignore", "ignore", "inherit"] },
	);
	if ((await proc.exited) !== 0) {
		throw new Error("could not compile the fake runtime");
	}
	return new Uint8Array(readFileSync(outfile));
}

/**
 * The environment a GUI-launched host gives the launcher: PATH without any
 * user toolchain. Windows also needs its system variables to start anything.
 */
export function launcherEnv(staged: Staged): Record<string, string> {
	const base = { HOME: staged.home, PLUGIN_DATA: staged.data };
	if (process.platform !== "win32") return { ...base, PATH: MINIMAL_PATH };
	const env: Record<string, string> = { ...base };
	for (const k of [
		"SystemRoot",
		"SystemDrive",
		"windir",
		"TEMP",
		"TMP",
		"USERPROFILE",
		"LOCALAPPDATA",
		"APPDATA",
		"ComSpec",
		"PATHEXT",
	]) {
		const v = process.env[k];
		if (v !== undefined) env[k] = v;
	}
	const root = env.SystemRoot ?? "C:\\Windows";
	env.PATH = `${root}\\System32;${root};${root}\\System32\\WindowsPowerShell\\v1.0`;
	return env;
}

export type ArtifactServer = Readonly<{
	url: string;
	requests: readonly string[];
	stop: () => void;
}>;

/** Serves `files` (path → bytes) over HTTP on 127.0.0.1 and logs requests. */
export function startArtifactServer(
	files: Readonly<Record<string, Uint8Array>>,
): ArtifactServer {
	const requests: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(req) {
			const path = new URL(req.url).pathname;
			requests.push(path);
			const body = files[path];
			return body === undefined
				? new Response("not found", { status: 404 })
				: new Response(new Blob([new Uint8Array(body)]));
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}`,
		requests,
		stop: () => server.stop(true),
	};
}

/** A URL on 127.0.0.1 where nothing listens: the network is "down". */
export function offlineUrl(): string {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(),
	});
	const url = `http://127.0.0.1:${server.port}`;
	server.stop(true);
	return url;
}

type StageOptions = Readonly<{
	target: Target;
	/** Bytes the manifest pins (checksum and signature). */
	pinned: Uint8Array;
	/** Where the artifact is downloaded from. */
	url: string;
	key: ReleaseKey;
	/** Sign with this key instead (a signature the pinned key rejects). */
	signingKey?: ReleaseKey;
	/** Omit the pinned public key from the staged launcher. */
	withoutKey?: boolean;
}>;

export type Staged = Readonly<{
	/** Launcher dir: launch.sh, launch.ps1, manifest.json, release keys. */
	dir: string;
	/** `PLUGIN_DATA` for the launcher. */
	data: string;
	home: string;
	/** Where a verified runtime is cached. */
	cached: string;
}>;

/** A launcher dir with a manifest for `target`, plus empty data and home dirs. */
export function stageLauncher(options: StageOptions): Staged {
	const root = mkdtempSync(join(tmpdir(), "maina-launcher-"));
	const dir = join(root, "launcher");
	const data = join(root, "plugin-data");
	const home = join(root, "home");
	for (const d of [dir, data, home]) mkdirSync(d, { recursive: true });
	for (const file of ["launch.sh", "launch.ps1"]) {
		copyFileSync(join(LAUNCHER_DIR, file), join(dir, file));
	}
	const signer = options.signingKey ?? options.key;
	const manifest: Manifest = {
		schema: 1,
		version: TEST_VERSION,
		artifacts: {
			[options.target]: {
				url: options.url,
				sha256: sha256Hex(options.pinned),
				signature: signArtifact(options.pinned, signer.privateKeyPem),
			},
		},
	};
	writeFileSync(join(dir, "manifest.json"), renderManifest(manifest));
	if (options.withoutKey !== true) {
		writeFileSync(join(dir, "release.pub.pem"), options.key.publicKeyPem);
		writeFileSync(
			join(dir, "release.pub.xml"),
			publicKeyXml(options.key.publicKeyPem),
		);
	}
	const exe = options.target.startsWith("windows") ? "maina.exe" : "maina";
	return {
		dir,
		data,
		home,
		cached: join(data, "runtime", TEST_VERSION, exe),
	};
}

type LaunchResult = Readonly<{
	exitCode: number;
	stdout: string;
	stderr: string;
	ms: number;
}>;

type LaunchOptions = Readonly<{
	/** The interpreter command, such as `["/bin/sh", "<dir>/launch.sh"]`. */
	command: readonly string[];
	staged: Staged;
	stdin?: string;
	timeoutMs?: number;
}>;

/** Runs the launcher with a GUI-like minimal env and collects its output. */
export async function runLauncher(
	args: readonly string[],
	options: LaunchOptions,
): Promise<LaunchResult> {
	const t0 = performance.now();
	const proc = Bun.spawn([...options.command, ...args], {
		cwd: options.staged.home,
		env: launcherEnv(options.staged),
		stdin: options.stdin === undefined ? "ignore" : "pipe",
		stdout: "pipe",
		stderr: "pipe",
		timeout: options.timeoutMs ?? 20_000,
	});
	if (options.stdin !== undefined && proc.stdin) {
		proc.stdin.write(options.stdin);
		await proc.stdin.end();
	}
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stdout, stderr, ms: performance.now() - t0 };
}
