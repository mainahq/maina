/**
 * Link refusal codes come from the vendored protocol (#644, cloud #265).
 *
 * The cloud publishes every code a Link route answers with in
 * `refusal.schema.json`. `LINK_CODES` is read from that schema, so a code
 * the runtime acts on is always one the cloud publishes, and a re-pin that
 * drops a code fails the typecheck where the runtime names it.
 */

import { describe, expect, test } from "bun:test";
import refusalSchema from "../protocol/v1/refusal.schema.json" with {
	type: "json",
};
import { LINK_CODES } from "../protocol/wire";

describe("LINK_CODES", () => {
	test("is exactly the published refusal codes, each keyed by itself", () => {
		const published = [...refusalSchema.properties.error.enum].sort();
		expect(Object.keys(LINK_CODES).sort()).toEqual(published);
		for (const [key, code] of Object.entries(LINK_CODES)) {
			expect<string>(code).toBe(key);
		}
	});

	test("names every code the runtime acts on", () => {
		expect([
			LINK_CODES.authorization_pending,
			LINK_CODES.slow_down,
			LINK_CODES.org_keys_unavailable,
			LINK_CODES.device_revoked,
			LINK_CODES.token_expired,
			LINK_CODES.invalid_token,
			LINK_CODES.missing_token,
		]).toEqual([
			"authorization_pending",
			"slow_down",
			"org_keys_unavailable",
			"device_revoked",
			"token_expired",
			"invalid_token",
			"missing_token",
		]);
	});
});
