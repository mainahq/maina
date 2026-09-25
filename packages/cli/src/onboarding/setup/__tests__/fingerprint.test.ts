import { describe, expect, test } from "bun:test";
import { deviceFingerprint } from "../fingerprint";

describe("deviceFingerprint", () => {
	test("returns a 16-char hex string", () => {
		const fp = deviceFingerprint();
		expect(fp).toMatch(/^[0-9a-f]{16}$/);
	});

	test("is deterministic across calls on the same machine", () => {
		const a = deviceFingerprint();
		const b = deviceFingerprint();
		expect(a).toBe(b);
	});
});
