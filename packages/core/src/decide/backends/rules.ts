/**
 * The rules backend: exact answers read straight from the policy. It serves
 * `action.risk` by looking up the action class's verdict; an action class
 * the policy does not know resolves to `ask` (fail closed).
 */

import type { Backend } from "../types";
import { answerEach, asString, degenerate, unsupported } from "./distribution";

export const rulesBackend: Backend = {
	id: "rules",
	version: "1",
	answer: ({ type, state, questions, policy }) => {
		if (type !== "action.risk") {
			return unsupported(undefined, `no rules for ${type}`);
		}
		const actionClass = asString(state.trusted.actionClass);
		const known =
			actionClass !== undefined &&
			Object.hasOwn(policy.action_classes, actionClass);
		const verdict = known
			? (policy.action_classes[actionClass]?.verdict ?? "ask")
			: "ask";
		return answerEach(questions, (q) =>
			q.kind === "choice" && q.options.includes(verdict)
				? degenerate(q, verdict)
				: undefined,
		);
	},
};
