import { expect } from "bun:test";
import { migrateDecisionLog } from "../../../db/decision-log";
import { DEFAULT_POLICY } from "../../../policy/defaults";
import type { Policy } from "../../../policy/schema";
import type { DbPort } from "../../../ports/db";
import { createFixedClock, createMemoryDb } from "../../../ports/testing";
import { type DecidePorts, decide } from "../../decide";
import { DEFAULT_REGISTRY } from "../../registry";
import type { DecideRequest, Decision } from "../../types";
import { buildDecisionRecord } from "../append";
import type { DecisionLogPrivacy, DecisionRecord } from "../schema";

export const SLOP_REQUEST: DecideRequest = {
	type: "slop",
	state: { trusted: {}, untrusted: { text: "console.log(1)" } },
	questions: [{ kind: "bool", id: "ai-console" }],
};

export const TIER_REQUEST: DecideRequest = {
	type: "task.tier",
	state: { trusted: { task: "commit" }, untrusted: {} },
	questions: [
		{
			kind: "choice",
			id: "tier",
			options: ["mechanical", "standard", "architectural"],
		},
	],
};

export function decidePorts(overrides: Partial<DecidePorts> = {}): DecidePorts {
	return {
		clock: createFixedClock(1_000),
		policy: DEFAULT_POLICY,
		backends: DEFAULT_REGISTRY,
		...overrides,
	};
}

export function unwrap<T, E>(
	result: { ok: true; value: T } | { ok: false; error: E },
): T {
	if (!result.ok) {
		expect(result.error).toBeUndefined();
		return undefined as never;
	}
	return result.value;
}

export function decideOne(
	request: DecideRequest,
	ports: DecidePorts = decidePorts(),
): Decision {
	const [decision] = unwrap(decide(ports, request));
	expect(decision).toBeDefined();
	return decision as Decision;
}

export function recordFor(
	request: DecideRequest,
	overrides: Partial<{
		id: string;
		ts: number;
		policy: Policy;
		finalAction: string;
		host: string;
		sessionId: string;
		ports: DecidePorts;
		privacy: DecisionLogPrivacy;
	}> = {},
): DecisionRecord {
	const ports = overrides.ports ?? decidePorts();
	return unwrap(
		buildDecisionRecord(
			{
				id: overrides.id ?? "dec-1",
				ts: overrides.ts ?? 1_700_000_000_000,
				request,
				decision: decideOne(request, ports),
				policy: overrides.policy ?? ports.policy,
				finalAction: overrides.finalAction ?? "flag",
				host: overrides.host,
				sessionId: overrides.sessionId,
			},
			overrides.privacy,
		),
	);
}

export function migratedDb(): DbPort {
	const db = createMemoryDb();
	unwrap(migrateDecisionLog(db));
	return db;
}
