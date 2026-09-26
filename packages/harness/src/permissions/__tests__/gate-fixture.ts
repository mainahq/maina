/**
 * Shared by the permission-bridge tests: a real gate (core's `evaluateGate`
 * with the bash grammar and the rules backend) over the default policy plus
 * one deny rule, and a log that keeps every record.
 */

import {
	DEFAULT_POLICY,
	DEFAULT_REGISTRY,
	loadShellParser,
	type Policy,
} from "@mainahq/core";
import type { GateBridge, PermissionRecord } from "../judge";

/** `npm publish` is denied outright; everything else is the default policy. */
export const DENY_PUBLISH: Policy = {
	...DEFAULT_POLICY,
	rules: { allow: [], deny: [{ match: "npm publish" }] },
};

export type TestBridge = GateBridge & Readonly<{ records: PermissionRecord[] }>;

export async function testBridge(
	policy: Policy = DENY_PUBLISH,
): Promise<TestBridge> {
	const shell = await loadShellParser();
	if (!shell.ok) {
		return Promise.reject(new Error(`bash grammar: ${shell.error.message}`));
	}
	const records: PermissionRecord[] = [];
	let n = 0;
	return {
		ports: {
			clock: { now: () => 0 },
			backends: DEFAULT_REGISTRY,
			ctx: { shell: shell.value, home: "/home/dev" },
			newId: () => `gate-${++n}`,
		},
		policy,
		log: (record) => {
			records.push(record);
		},
		records,
	};
}
