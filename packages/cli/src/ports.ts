/**
 * Real adapters for the core ports the CLI hands over: the filesystem and
 * the outbound network. Like `env.ts`, this edge is the only place the CLI
 * gives core real I/O. Adapters never throw; failures come back as `Result`.
 */

import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import type {
	FsError,
	FsPort,
	HttpPort,
	NetworkPort,
	TelemetryContext,
} from "@mainahq/core";
import { processEnv } from "./env";

function fsError(path: string, error: unknown): FsError {
	const code = (error as { code?: unknown } | null)?.code;
	if (code === "ENOENT" || code === "ENOTDIR")
		return { kind: "not_found", path };
	return {
		kind: "io",
		path,
		message: error instanceof Error ? error.message : String(error),
	};
}

export const nodeFs: FsPort = {
	readFile: async (path) => {
		try {
			return { ok: true, value: await readFile(path, "utf-8") };
		} catch (error) {
			return { ok: false, error: fsError(path, error) };
		}
	},
	writeFile: async (path, content) => {
		try {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content, "utf-8");
			return { ok: true, value: undefined };
		} catch (error) {
			return { ok: false, error: fsError(path, error) };
		}
	},
	exists: async (path) => {
		try {
			await stat(path);
			return true;
		} catch {
			return false;
		}
	},
	readDir: async (path) => {
		try {
			return { ok: true, value: (await readdir(path)).sort() };
		} catch (error) {
			return { ok: false, error: fsError(path, error) };
		}
	},
	remove: async (path) => {
		try {
			await stat(path);
			await rm(path, { recursive: true, force: true });
			return { ok: true, value: undefined };
		} catch (error) {
			return { ok: false, error: fsError(path, error) };
		}
	},
};

/** `fetch`-backed POSTs, aborted after `timeoutMs`. */
export const fetchNetwork: NetworkPort = {
	post: async ({ url, body, headers, timeoutMs }) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: { ...headers },
				body,
				signal: controller.signal,
			});
			return res.ok
				? { ok: true, value: { status: res.status } }
				: { ok: false, error: { kind: "http", url, status: res.status } };
		} catch (error) {
			if (controller.signal.aborted) {
				return { ok: false, error: { kind: "timeout", url } };
			}
			return {
				ok: false,
				error: {
					kind: "network",
					url,
					message: error instanceof Error ? error.message : String(error),
				},
			};
		} finally {
			clearTimeout(timer);
		}
	},
};

/**
 * `fetch`-backed HTTP for the GitHub surfaces: any status comes back as a
 * value (core decides what a 403 means); only transport failures are errors.
 */
export const fetchHttp: HttpPort = {
	request: async ({ method, url, headers, body, timeoutMs }) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(url, {
				method,
				headers: { ...headers },
				...(body === undefined ? {} : { body }),
				signal: controller.signal,
			});
			return {
				ok: true,
				value: { status: res.status, body: await res.text() },
			};
		} catch (error) {
			if (controller.signal.aborted) {
				return { ok: false, error: { kind: "timeout", url } };
			}
			return {
				ok: false,
				error: {
					kind: "network",
					url,
					message: error instanceof Error ? error.message : String(error),
				},
			};
		} finally {
			clearTimeout(timer);
		}
	},
};

/** What core's consent checks read for a command running at `root`. */
export function telemetryContext(root: string): TelemetryContext {
	return { fs: nodeFs, env: processEnv, root };
}

/**
 * The working directory, or undefined when it cannot be read (for example,
 * it was deleted). For the crash path, which must never throw.
 */
export function safeCwd(
	cwd: () => string = () => process.cwd(),
): string | undefined {
	try {
		return cwd();
	} catch {
		return undefined;
	}
}
