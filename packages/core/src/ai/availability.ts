import { getApiKey, isHostMode } from "../config/index";
import type { EnvPort } from "../ports/env";

export interface AIAvailability {
	available: boolean;
	method: "api-key" | "host-delegation" | "none";
	reason?: string;
}

export function checkAIAvailability(env: EnvPort): AIAvailability {
	const apiKey = getApiKey(env);
	if (apiKey !== null) {
		return { available: true, method: "api-key" };
	}
	if (isHostMode(env)) {
		return { available: true, method: "host-delegation" };
	}
	return {
		available: false,
		method: "none",
		reason:
			"No API key found and not running inside an AI agent. Run `maina init` to set up or run inside Claude Code/Cursor.",
	};
}
