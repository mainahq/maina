/**
 * Recovery commands printed to the user when `maina setup` falls to the
 * degraded tier. One entry per normalised reason — table-driven, deterministic,
 * no LLM call.
 *
 * Update in lockstep with the `SetupDegradedReason` union: unhandled cases
 * fail the exhaustive switch at compile time.
 */

export type SetupDegradedReason =
	| "host_unavailable"
	| "rate_limited"
	| "byok_failed"
	| "no_key"
	| "ai_unavailable"
	| "forced";

/**
 * Short, reason-specific banner line for the terminal warning. Distinct from
 * `recoveryCommand` (which is the one-line remedy) so the user sees both:
 *
 *   log.warning(degradedBanner(reason))
 *   log.info("→ " + recoveryCommand(reason))
 */
export function degradedBanner(reason: SetupDegradedReason): string {
	switch (reason) {
		case "host_unavailable":
			return "Host AI unavailable — offline template written.";
		case "rate_limited":
			return "Cloud setup proxy is rate-limited — offline template written.";
		case "byok_failed":
			return "BYOK call failed — offline template written.";
		case "no_key":
			return "No API key configured — offline template written.";
		case "ai_unavailable":
			return "All AI tiers unavailable — offline template written.";
		case "forced":
			return "Degraded tier forced — offline template written.";
	}
}

export function recoveryCommand(reason: SetupDegradedReason): string {
	switch (reason) {
		case "host_unavailable":
			return "Host AI was unavailable. Re-run inside Claude Code or install Ollama: `brew install ollama` then `maina setup --update`.";
		case "rate_limited":
			return "Cloud setup proxy is rate-limited. Retry in a minute, or set OPENROUTER_API_KEY and run `maina setup --update`.";
		case "byok_failed":
			return "Your API key did not work. Run `maina doctor` to check connectivity, then `maina setup --update`.";
		case "no_key":
			return "Set OPENROUTER_API_KEY=sk-... (or ANTHROPIC_API_KEY) and run `maina setup --update` to upgrade from the offline template.";
		case "ai_unavailable":
			return "No AI tier succeeded. Check connectivity with `maina doctor`, set an API key, then run `maina setup --update`.";
		case "forced":
			return "Degraded tier was forced. Drop `--force=degraded` and re-run `maina setup` to try the live tiers.";
	}
}
