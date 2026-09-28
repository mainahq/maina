/**
 * Where an enrolled device keeps its Link identity (#589, adr 0051).
 *
 * One directory per user, `~/.maina/link` (or `MAINA_LINK_DIR`), created
 * owner-only (0700), holding two owner-only (0600) files:
 *
 *   device.key   the Ed25519 private key, PKCS#8 PEM
 *   device.json  the enrolment: device and org ids, the pinned org keys,
 *                the org link salt, the endpoints, the revocation mark
 *
 * Files are written to a fresh owner-only temp file and renamed into place,
 * so a crash never leaves half a key and an existing file with looser
 * permissions is replaced, not reused. A key file that group or others can
 * read is refused on read, as ssh does. No access token is ever stored:
 * tokens live in memory for their 15 minutes (`token.ts`).
 */

import { randomBytes } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Result } from "@mainahq/core";
import {
	type DataClass,
	type DeviceKind,
	type EnrolCompleteResult,
	parseWire,
} from "./protocol/wire";

/** An enrolled device, as `device.json` holds it. */
export type DeviceState = Readonly<{
	v: 1;
	/** The cloud this device enrolled with. */
	baseUrl: string;
	kind: DeviceKind;
	/** The device's public key, as sent at enrolment. */
	publicKey: string;
	enrolledAt: string;
	/** Set when the cloud answered `device_revoked`: Link stays stopped. */
	revokedAt: string | null;
	/** The org's data class; `metadata` until a policy bundle says otherwise. */
	dataClass: DataClass;
	/** The enrolment result; `orgKeys` change only by a verified rotation. */
	enrolment: EnrolCompleteResult;
	/** Control message ids already applied (newest last), to refuse replays. */
	appliedControls: readonly string[];
}>;

export type StoreError =
	| Readonly<{ kind: "store"; op: string; message: string }>
	| Readonly<{ kind: "insecure_key"; path: string; mode: number }>
	| Readonly<{ kind: "corrupt_state"; path: string; message: string }>;

export type LinkStore = Readonly<{
	readState: () => Result<DeviceState | null, StoreError>;
	writeState: (state: DeviceState) => Result<void, StoreError>;
	readPrivateKey: () => Result<string | null, StoreError>;
	writePrivateKey: (pem: string) => Result<void, StoreError>;
	/** Removes the key and the state (a local logout). */
	clear: () => Result<void, StoreError>;
}>;

const KEY_FILE = "device.key";
const STATE_FILE = "device.json";
const DATA_CLASSES: readonly DataClass[] = ["metadata", "names", "rich"];

/** `MAINA_LINK_DIR`, else `<home>/.maina/link`. */
export function linkDir(
	env: Readonly<{ get: (name: string) => string | undefined }>,
	home: string,
): string {
	const override = env.get("MAINA_LINK_DIR");
	return override !== undefined && override !== ""
		? override
		: join(home, ".maina", "link");
}

function message(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function isMissing(e: unknown): boolean {
	return (e as { code?: unknown }).code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` as a device state, or why not. */
function parseState(value: unknown): Result<DeviceState, string> {
	if (!isRecord(value) || value.v !== 1) {
		return { ok: false, error: "not a v1 device state" };
	}
	const strings = ["baseUrl", "publicKey", "enrolledAt"] as const;
	for (const field of strings) {
		if (typeof value[field] !== "string") {
			return { ok: false, error: `${field} is not a string` };
		}
	}
	if (value.kind !== "workstation" && value.kind !== "ci") {
		return { ok: false, error: "kind is not workstation or ci" };
	}
	if (value.revokedAt !== null && typeof value.revokedAt !== "string") {
		return { ok: false, error: "revokedAt is not a timestamp" };
	}
	if (!DATA_CLASSES.includes(value.dataClass as DataClass)) {
		return { ok: false, error: "dataClass is not a data class" };
	}
	if (
		!Array.isArray(value.appliedControls) ||
		!value.appliedControls.every((id) => typeof id === "string")
	) {
		return { ok: false, error: "appliedControls is not a list of ids" };
	}
	const enrolment = parseWire("enrol-complete-result", value.enrolment);
	if (!enrolment.ok) {
		return {
			ok: false,
			error: `enrolment: ${enrolment.error.problems.join("; ")}`,
		};
	}
	return { ok: true, value: value as DeviceState };
}

/**
 * The store under `dir`. `platform` decides whether POSIX modes apply: on
 * Windows the files inherit the user profile's ACL instead (adr 0051).
 */
export function fileLinkStore(
	dir: string,
	platform: NodeJS.Platform = process.platform,
): LinkStore {
	const posix = platform !== "win32";
	const keyPath = join(dir, KEY_FILE);
	const statePath = join(dir, STATE_FILE);

	function ensureDir(): Result<void, StoreError> {
		try {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			if (posix) chmodSync(dir, 0o700);
			return { ok: true, value: undefined };
		} catch (e) {
			return {
				ok: false,
				error: { kind: "store", op: "mkdir", message: message(e) },
			};
		}
	}

	/** Owner-only temp file, then an atomic rename over `path`. */
	function writeOwnerOnly(
		path: string,
		text: string,
	): Result<void, StoreError> {
		const dirReady = ensureDir();
		if (!dirReady.ok) return dirReady;
		const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
		try {
			writeFileSync(tmp, text, { mode: 0o600, flag: "wx" });
			if (posix) chmodSync(tmp, 0o600);
			renameSync(tmp, path);
			return { ok: true, value: undefined };
		} catch (e) {
			rmSync(tmp, { force: true });
			return {
				ok: false,
				error: { kind: "store", op: "write", message: message(e) },
			};
		}
	}

	return {
		readState: () => {
			let text: string;
			try {
				text = readFileSync(statePath, "utf-8");
			} catch (e) {
				if (isMissing(e)) return { ok: true, value: null };
				return {
					ok: false,
					error: { kind: "store", op: "read", message: message(e) },
				};
			}
			let json: unknown;
			try {
				json = JSON.parse(text);
			} catch (e) {
				return {
					ok: false,
					error: {
						kind: "corrupt_state",
						path: statePath,
						message: message(e),
					},
				};
			}
			const state = parseState(json);
			return state.ok
				? state
				: {
						ok: false,
						error: {
							kind: "corrupt_state",
							path: statePath,
							message: state.error,
						},
					};
		},
		writeState: (state) =>
			writeOwnerOnly(statePath, `${JSON.stringify(state, null, "\t")}\n`),
		readPrivateKey: () => {
			try {
				const mode = statSync(keyPath).mode & 0o777;
				if (posix && (mode & 0o077) !== 0) {
					return {
						ok: false,
						error: { kind: "insecure_key", path: keyPath, mode },
					};
				}
				return { ok: true, value: readFileSync(keyPath, "utf-8") };
			} catch (e) {
				if (isMissing(e)) return { ok: true, value: null };
				return {
					ok: false,
					error: { kind: "store", op: "read", message: message(e) },
				};
			}
		},
		writePrivateKey: (pem) => writeOwnerOnly(keyPath, pem),
		clear: () => {
			try {
				rmSync(keyPath, { force: true });
				rmSync(statePath, { force: true });
				return { ok: true, value: undefined };
			} catch (e) {
				return {
					ok: false,
					error: { kind: "store", op: "remove", message: message(e) },
				};
			}
		},
	};
}

/** Records a `device_revoked` answer, once; later calls keep the first time. */
export function markRevoked(
	store: LinkStore,
	now: Date,
): Result<DeviceState | null, StoreError> {
	const read = store.readState();
	if (!read.ok || read.value === null || read.value.revokedAt !== null) {
		return read;
	}
	const revoked: DeviceState = { ...read.value, revokedAt: now.toISOString() };
	const written = store.writeState(revoked);
	return written.ok ? { ok: true, value: revoked } : written;
}

type DeviceSummary = Readonly<{
	deviceId: string;
	orgId: string;
	baseUrl: string;
	deviceKind: DeviceKind;
	enrolledAt: string;
	dataClass: DataClass;
	orgKeys: readonly Readonly<{ keyId: string; purpose: string }>[];
}>;

export type DeviceStatus =
	| Readonly<{ kind: "not_enrolled" }>
	| (Readonly<{ kind: "enrolled" }> & DeviceSummary)
	| (Readonly<{ kind: "revoked"; revokedAt: string }> & DeviceSummary)
	| Readonly<{ kind: "unreadable"; error: StoreError }>;

/**
 * What `maina cloud status` shows. Ids, the cloud, key ids and the data
 * class only: never the link salt, a public or private key, or a token.
 */
export function deviceStatus(store: LinkStore): DeviceStatus {
	const read = store.readState();
	if (!read.ok) return { kind: "unreadable", error: read.error };
	const state = read.value;
	if (state === null) return { kind: "not_enrolled" };
	const summary: DeviceSummary = {
		deviceId: state.enrolment.deviceId,
		orgId: state.enrolment.orgId,
		baseUrl: state.baseUrl,
		deviceKind: state.kind,
		enrolledAt: state.enrolledAt,
		dataClass: state.dataClass,
		orgKeys: state.enrolment.orgKeys.map((k) => ({
			keyId: k.keyId,
			purpose: k.purpose,
		})),
	};
	return state.revokedAt === null
		? { kind: "enrolled", ...summary }
		: { kind: "revoked", revokedAt: state.revokedAt, ...summary };
}
