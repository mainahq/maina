/**
 * Per-phase JSON emitter for `maina setup --ci`.
 *
 * The CI mode emits one single-line JSON object per pipeline phase to stdout
 * (preflight → detect → infer → scaffold → wiki → verify → done) so an
 * orchestrator can stream-parse setup progress without screen-scraping the
 * human UX. The emitter is the *only* stdout writer in CI mode; nothing else
 * may write to stdout while a CI run is in flight.
 *
 * Pluggable via DI: tests pass a writer spy to capture lines without touching
 * `process.stdout`. Interactive mode uses `noopEmitter()` so the wizard can
 * call `emitter.phase(...)` unconditionally without polluting the TTY.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type PhaseName =
	| "preflight"
	| "detect"
	| "infer"
	| "scaffold"
	| "wiki"
	| "verify"
	| "done";

export type PhaseStatus = "ok" | "skipped" | "error" | "degraded";

export interface PhaseEvent {
	phase: PhaseName;
	status: PhaseStatus;
	// Phase-specific fields (languages, aiSource, files, pages, findings, etc.)
	[key: string]: unknown;
}

export interface SetupEmitter {
	phase(event: PhaseEvent): void;
	done(event: PhaseEvent & { phase: "done" }): void;
}

// ── Implementations ──────────────────────────────────────────────────────────

/**
 * JSON-line emitter. Writes one single-line JSON object per call via the
 * supplied writer. The default writer streams to stdout with a trailing `\n`;
 * the writer is invoked with the *raw* JSON string (no embedded newline) so
 * tests can assert each line is parseable on its own.
 */
export function jsonEmitter(
	write: (line: string) => void = (l) => {
		process.stdout.write(`${l}\n`);
	},
): SetupEmitter {
	const emit = (event: PhaseEvent): void => {
		// Force single-line output. JSON.stringify with no spacing has no
		// embedded newlines for plain values; structured fields stay compact.
		const line = JSON.stringify(event);
		write(line);
	};
	return {
		phase: emit,
		done: emit,
	};
}

/**
 * No-op emitter for interactive mode. Allows call sites to invoke
 * `emitter.phase(...)` unconditionally.
 */
export function noopEmitter(): SetupEmitter {
	return {
		phase: () => {},
		done: () => {},
	};
}
