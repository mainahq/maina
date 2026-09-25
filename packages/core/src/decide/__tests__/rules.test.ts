import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "../../policy/defaults";
import type { Policy } from "../../policy/schema";
import { createFixedClock } from "../../ports/testing";
import { decide } from "../decide";
import { DEFAULT_REGISTRY } from "../registry";

function verdict(actionClass: string, policy: Policy = DEFAULT_POLICY) {
	const result = decide(
		{ clock: createFixedClock(0), policy, backends: DEFAULT_REGISTRY },
		{
			type: "action.risk",
			state: { trusted: { actionClass }, untrusted: {} },
			questions: [
				{ kind: "choice", id: "verdict", options: ["allow", "ask", "deny"] },
			],
		},
	);
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value[0];
}

describe("rules backend", () => {
	test("answers with the policy verdict for the action class", () => {
		expect(verdict("git.push.force")?.answer).toBe("ask");
		expect(verdict("fs.write")?.answer).toBe("allow");
		expect(verdict("fs.write")?.backend.id).toBe("rules");
	});

	test("follows a tightened policy", () => {
		const policy: Policy = {
			...DEFAULT_POLICY,
			action_classes: {
				...DEFAULT_POLICY.action_classes,
				deploy: { irreversible: true, verdict: "deny" },
			},
		};
		expect(verdict("deploy", policy)?.answer).toBe("deny");
	});

	test("fails closed to ask for an unknown action class", () => {
		expect(verdict("teleport.prod")?.answer).toBe("ask");
		expect(verdict("__proto__")?.answer).toBe("ask");
	});
});
