import { getApiKey, isHostMode } from "../config/index";

export interface AIAvailability {
	available: boolean;
	method: "api-key" | "host-delegation" | "none";
	reason?: string;
}

export function checkAIAvailability(): AIAvailability {
	const apiKey = getApiKey();
	if (apiKey !== null) {
		return { available: true, method: "api-key" };
	}
	if (isHostMode()) {
		return { available: true, method: "host-delegation" };
	}
	return {
		available: false,
		method: "none",
		reason:
			"No API key found and not running inside an AI agent. Run `maina init` to set up or run inside Claude Code/Cursor.",
	};
}
