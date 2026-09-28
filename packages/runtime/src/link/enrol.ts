/**
 * Device enrolment (#589, spec §6.3 "Enrol", FR-ID-6, cloud adr/0010).
 *
 * 1. `POST /link/v1/enrol/start` with the device's kind, OS, arch and
 *    runtime version (and an optional label). A CI runner presents its
 *    scoped API token as `Authorization: Bearer` on this call only; its code
 *    starts approved. A workstation shows the user code to its member.
 * 2. The Ed25519 key pair is generated here, on the machine, and the
 *    private key goes straight to the owner-only store (`store.ts`).
 * 3. `POST /link/v1/enrol/complete` carries the public key and the proof:
 *    the device's signature over the message, which names the device code.
 *    It is polled every `interval` seconds while the answer is
 *    `authorization_pending` (or `org_keys_unavailable`), until the code
 *    expires.
 *    The message lists `accepts: ["dataClass"]`, so the cloud answers with
 *    the org's data class (cloud #265); it sends no field a device did not
 *    ask for.
 * 4. The result is pinned: device and org ids, the org verification keys
 *    (one per purpose, or the enrolment is refused: without a link-control
 *    key no rotation could ever be verified), the link salt, the endpoints,
 *    and the org's data class (`metadata` when the cloud sends none).
 *
 * A failure leaves nothing behind: no key, no state.
 */

import type { Result } from "@mainahq/core";
import {
	checkBaseUrl,
	isSuccess,
	type LinkFailure,
	linkCall,
	refusal,
} from "./http";
import { deviceSigningInput } from "./keys";
import {
	type EnrolCompleteResult,
	LINK_CODES,
	ORG_KEY_PURPOSES,
	type OrgKeyPurpose,
	parseWire,
} from "./protocol/wire";
import type { DeviceState } from "./store";
import type { LinkPorts } from "./token";

export type EnrolPorts = LinkPorts &
	Readonly<{ sleep: (ms: number) => Promise<void> }>;

type DeviceFacts = Readonly<{
	/** `darwin`, `linux`, `windows` or `other`. */
	os: string;
	arch: string;
	runtimeVersion: string;
	label?: string;
}>;

type UserCodePrompt = Readonly<{
	userCode: string;
	verificationUri: string;
	expiresIn: number;
}>;

export type EnrolOptions = Readonly<{
	baseUrl: string;
	/** A CI-enrolment API token (`device.enrol.ci`): enrols as `ci`. */
	ciToken?: string;
	device: DeviceFacts;
	/** Shows the user code to the member who approves it (workstations). */
	onUserCode?: (prompt: UserCodePrompt) => void;
}>;

export type EnrolError =
	| Readonly<{ kind: "already_enrolled"; deviceId: string }>
	| Readonly<{ kind: "invalid_request"; problems: readonly string[] }>
	| Readonly<{ kind: "expired" }>
	| Readonly<{ kind: "org_keys_incomplete"; missing: readonly OrgKeyPurpose[] }>
	| LinkFailure;

/** RFC 8628: `slow_down` adds five seconds to the interval. */
const SLOW_DOWN_MS = 5_000;

const KEEP_POLLING: ReadonlySet<string> = new Set([
	LINK_CODES.authorization_pending,
	LINK_CODES.org_keys_unavailable,
	LINK_CODES.slow_down,
]);

function missingPurposes(result: EnrolCompleteResult): OrgKeyPurpose[] {
	return ORG_KEY_PURPOSES.filter(
		(p) => !result.orgKeys.some((k) => k.purpose === p),
	);
}

/** Enrols this device and stores its key and enrolment. */
export async function enrolDevice(
	ports: EnrolPorts,
	options: EnrolOptions,
): Promise<Result<DeviceState, EnrolError>> {
	const base = checkBaseUrl(options.baseUrl);
	if (!base.ok) return base;
	const existing = ports.store.readState();
	if (!existing.ok) return existing;
	if (existing.value !== null && existing.value.revokedAt === null) {
		return {
			ok: false,
			error: {
				kind: "already_enrolled",
				deviceId: existing.value.enrolment.deviceId,
			},
		};
	}

	const kind = options.ciToken === undefined ? "workstation" : "ci";
	const start = parseWire("enrol-start", {
		v: 1,
		kind,
		os: options.device.os,
		arch: options.device.arch,
		runtimeVersion: options.device.runtimeVersion,
		...(options.device.label === undefined
			? {}
			: { label: options.device.label }),
	});
	if (!start.ok) {
		return {
			ok: false,
			error: { kind: "invalid_request", problems: start.error.problems },
		};
	}
	const started = await linkCall(
		ports.http,
		"POST",
		`${base.value}/link/v1/enrol/start`,
		start.value,
		options.ciToken === undefined
			? {}
			: { Authorization: `Bearer ${options.ciToken}` },
	);
	if (!started.ok) return started;
	if (!isSuccess(started.value)) {
		return { ok: false, error: refusal(started.value) };
	}
	const code = parseWire("enrol-start-result", started.value.envelope.data);
	if (!code.ok) {
		return {
			ok: false,
			error: {
				kind: "invalid_response",
				message: `enrol/start: ${code.error.problems.join("; ")}`,
			},
		};
	}
	if (kind === "workstation") {
		options.onUserCode?.({
			userCode: code.value.userCode,
			verificationUri: code.value.verificationUri,
			expiresIn: code.value.expiresIn,
		});
	}

	const keys = ports.crypto.generateKeyPair();
	if (!keys.ok) return keys;
	const stored = ports.store.writePrivateKey(keys.value.privateKey);
	if (!stored.ok) return stored;

	const completed = await complete(ports, base.value, code.value, keys.value);
	if (!completed.ok) {
		ports.store.clear();
		return completed;
	}
	const state: DeviceState = {
		v: 1,
		baseUrl: base.value,
		kind,
		publicKey: keys.value.publicKey,
		enrolledAt: ports.clock().toISOString(),
		revokedAt: null,
		dataClass: completed.value.dataClass ?? "metadata",
		enrolment: completed.value,
		appliedControls: [],
	};
	const written = ports.store.writeState(state);
	if (!written.ok) {
		ports.store.clear();
		return written;
	}
	return { ok: true, value: state };
}

/** Signs the proof and polls `enrol/complete` until approved or expired. */
async function complete(
	ports: EnrolPorts,
	base: string,
	code: Readonly<{ deviceCode: string; expiresIn: number; interval: number }>,
	keys: Readonly<{ publicKey: string; privateKey: string }>,
): Promise<Result<EnrolCompleteResult, EnrolError>> {
	const unsigned = {
		v: 1,
		deviceCode: code.deviceCode,
		alg: "ed25519",
		publicKey: keys.publicKey,
		accepts: ["dataClass"],
	} as const;
	const input = deviceSigningInput("enrol-proof", unsigned, "proof");
	if (!input.ok) return input;
	const proof = ports.crypto.sign(keys.privateKey, input.value);
	if (!proof.ok) return proof;
	const message = parseWire("enrol-complete", {
		...unsigned,
		proof: proof.value,
	});
	if (!message.ok) return message;

	const deadline = ports.clock().getTime() + code.expiresIn * 1000;
	let interval = code.interval * 1000;
	for (;;) {
		const answer = await linkCall(
			ports.http,
			"POST",
			`${base}/link/v1/enrol/complete`,
			message.value,
		);
		if (!answer.ok) return answer;
		if (isSuccess(answer.value)) {
			const result = parseWire(
				"enrol-complete-result",
				answer.value.envelope.data,
			);
			if (!result.ok) {
				return {
					ok: false,
					error: {
						kind: "invalid_response",
						message: `enrol/complete: ${result.error.problems.join("; ")}`,
					},
				};
			}
			const missing = missingPurposes(result.value);
			if (missing.length > 0) {
				return { ok: false, error: { kind: "org_keys_incomplete", missing } };
			}
			return result;
		}
		const refused = answer.value.envelope.error ?? "";
		if (!KEEP_POLLING.has(refused)) {
			return { ok: false, error: refusal(answer.value) };
		}
		if (refused === LINK_CODES.slow_down) interval += SLOW_DOWN_MS;
		if (ports.clock().getTime() + interval >= deadline) {
			return { ok: false, error: { kind: "expired" } };
		}
		await ports.sleep(interval);
	}
}
