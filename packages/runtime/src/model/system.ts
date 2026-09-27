/**
 * The System 1 model on this machine (#338): the real ports behind
 * `maina model status|pull|verify` and the model the resident runtime
 * serves.
 *
 * - The pin is the one bundled into the runtime (`model.json`, #573).
 * - The cache is the host plugin's data dir, else `~/.maina/models`
 *   (`fetch.ts`).
 * - The target is this machine's (`hostTarget`, musl detected as the
 *   launcher detects it).
 * - Signatures verify against the release key pinned in the runtime
 *   binary. That key (#424) is provisioned by #574; until then
 *   `RELEASE_PUBLIC_KEY` is null, nothing verifies, and `system1` stays
 *   off, as it does while no release is pinned.
 *
 * The runtime loads only a release that is already cached; it never
 * downloads on its own. `maina model pull` does, once.
 */

import { verify } from "node:crypto";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import {
	type ModelCommandPorts,
	type ModelStatus,
	runModel,
} from "@mainahq/cli/src/commands/model";
import type { Result } from "@mainahq/core";
import { hostTarget } from "../../build/standalone";
import { engineSupport } from "./engine";
import {
	modelCacheFallbacks,
	modelCacheRoot,
	modelReleaseDir,
	pullModel,
	verifyCachedModel,
} from "./fetch";
import type { LoadedModel } from "./infer";
import { type LoadRefusal, loadModel } from "./load";
import { type ModelPinFile, SHIPPED_PIN } from "./pin";

/**
 * The public half of the model release key (#424), PEM. #574 pins it; no
 * environment variable or config file can replace it.
 */
const RELEASE_PUBLIC_KEY: string | null = null;

/** RSA-SHA256 over the pinned release key; false while none is pinned. */
function releaseSignatureCheck(bytes: Uint8Array, signature: string): boolean {
	if (RELEASE_PUBLIC_KEY === null) return false;
	try {
		return verify(
			"sha256",
			bytes,
			RELEASE_PUBLIC_KEY,
			Buffer.from(signature, "base64"),
		);
	} catch {
		return false;
	}
}

/** glibc or musl Linux, as `launcher/launch.sh` tells them apart. */
function isMusl(): boolean {
	if (process.platform !== "linux") return false;
	try {
		return readdirSync("/lib").some((f) => /^ld-musl-.+\.so\.1$/.test(f));
	} catch {
		return false;
	}
}

/** A pin that cannot be read pins nothing. */
const UNPINNED: ModelPinFile = {
	name: "maina-system1",
	version: null,
	manifestSha256: null,
	baseUrl: "https://github.com/mainahq/maina/releases/download",
};

function systemSource() {
	return {
		pin: SHIPPED_PIN.ok ? SHIPPED_PIN.value : UNPINNED,
		root: modelCacheRoot(process.env, homedir()),
		// A release pulled from a terminal, outside the plugin, is found too.
		fallbackRoots: modelCacheFallbacks(process.env, homedir()),
		target: hostTarget(process.platform, process.arch, isMusl()) ?? "unknown",
		verifySignature: releaseSignatureCheck,
	};
}

/**
 * Loads this machine's cached model (`infer.ts` `createSystem1Port` serves
 * it once it has loaded), or the notice saying why it cannot.
 */
export function loadSystemModel(): Promise<Result<LoadedModel, LoadRefusal>> {
	return loadModel(systemSource());
}

async function status(): Promise<ModelStatus> {
	const source = systemSource();
	const { pin, target } = source;
	const support = engineSupport(target);
	const engine =
		support === undefined
			? undefined
			: {
					engine: support.engine,
					shadowOnly: support.shadowOnly,
					notice: support.notice,
				};
	const base = {
		name: pin.name,
		version: pin.version,
		dir: pin.version === null ? null : modelReleaseDir(source.root, pin),
		target,
		engine,
	};
	const cached = verifyCachedModel(source);
	if (cached.ok) {
		return { ...base, dir: cached.value.dir, state: { kind: "verified" } };
	}
	const { kind, message } = cached.error;
	return {
		...base,
		state:
			kind === "unpinned" || kind === "not_installed"
				? { kind }
				: { kind: "unverified", message },
	};
}

function systemModelPorts(): ModelCommandPorts {
	return {
		status,
		pull: async () => {
			const pulled = await pullModel({ ...systemSource(), fetchUrl: fetch });
			return pulled.ok
				? {
						ok: true,
						value: {
							dir: pulled.value.dir,
							version: pulled.value.release.manifest.version,
							downloaded: pulled.value.downloaded,
						},
					}
				: { ok: false, error: { message: pulled.error.message } };
		},
		verify: async () => {
			const cached = verifyCachedModel(systemSource());
			return cached.ok
				? {
						ok: true,
						value: {
							dir: cached.value.dir,
							version: cached.value.release.manifest.version,
						},
					}
				: { ok: false, error: { message: cached.error.message } };
		},
		stdout: (text) => process.stdout.write(text),
		stderr: (text) => process.stderr.write(text),
	};
}

/** One `maina model <args>` process; resolves to the exit code. */
export function runModelProcess(args: readonly string[]): Promise<number> {
	return runModel(args, systemModelPorts());
}
