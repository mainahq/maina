/**
 * The ACP permission bridge (FR-HAR-2). Pure: the gate and the log are
 * injected.
 *
 * Every `session/request_permission` an ACP agent sends is normalised by
 * `../events` into core `GateEvent`s; `bridgeAcpPermission` runs the gate on
 * them, logs the request with its answer, and picks the option the agent is
 * answered with: `allow_once` for an allow (never a standing allow, which
 * would let later calls skip the gate), `reject_once` (or a standing reject)
 * for `ask` and `deny`, `cancelled` when nothing on offer fits.
 *
 * `acpGatePolicy` is the same bridge as the orchestrator's
 * `PermissionPolicy`, so `startRun({ policy: acpGatePolicy(bridge) })` gates
 * and logs every request of the run.
 */

import type { PermissionOptionKind } from "@agentclientprotocol/sdk";
import type { Verdict } from "@mainahq/core";
import { chooseOption, type PermissionRequest } from "../events";
import type { PermissionPolicy } from "../session";
import { type GateBridge, judgeActions, logPermission } from "./judge";

export type AcpAnswer = Readonly<{
	verdict: Verdict;
	reason: string;
	/** The kind of option chosen, or `cancelled` when none fits the verdict. */
	kind: PermissionOptionKind | "cancelled";
	/** The option the agent is answered with; absent when cancelled. */
	optionId?: string;
}>;

export function bridgeAcpPermission(
	bridge: GateBridge,
	request: PermissionRequest,
): AcpAnswer {
	const judged = judgeActions(bridge, request.gate, request.opaque);
	const optionId = chooseOption(request.options, judged.verdict);
	const kind =
		request.options.find((o) => o.optionId === optionId)?.kind ?? "cancelled";
	const [first] = request.gate;
	logPermission(bridge, {
		source: "acp",
		host: first?.host ?? "acp",
		sessionId: first?.sessionId ?? "",
		toolCallId: request.toolCallId,
		gate: request.gate,
		opaque: request.opaque,
		...judged,
		answer: kind,
	});
	return {
		verdict: judged.verdict,
		reason: judged.reason,
		kind,
		...(optionId === undefined ? {} : { optionId }),
	};
}

/** The bridge as a run's permission policy: every request gated and logged. */
export function acpGatePolicy(bridge: GateBridge): PermissionPolicy {
	return (request) => bridgeAcpPermission(bridge, request).verdict;
}
