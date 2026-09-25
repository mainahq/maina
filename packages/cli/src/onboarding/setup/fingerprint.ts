/**
 * Setup — Anonymous Device Fingerprint
 *
 * Deterministic, non-PII identifier used by the cloud `/v1/setup` proxy to
 * rate-limit anonymous traffic per device. Does NOT include the user name,
 * working directory, or anything personally identifying.
 *
 * SHA-256 of `${hostname}|${platform}|${arch}` truncated to the first 16
 * hex characters. Same machine → same fingerprint across runs.
 */

import { createHash } from "node:crypto";
import { arch, hostname, platform } from "node:os";

/**
 * Compute a stable 16-char hex fingerprint for the current device.
 *
 * The truncation is intentional: 64 bits of entropy is more than enough to
 * bucket cloud rate-limit counters while keeping the value short in logs.
 */
export function deviceFingerprint(): string {
	const blob = `${hostname()}|${platform()}|${arch()}`;
	return createHash("sha256").update(blob).digest("hex").slice(0, 16);
}
