/** Wall-clock time, injected so core stays deterministic under test. */
export type ClockPort = Readonly<{
	/** Milliseconds since the Unix epoch. */
	now: () => number;
}>;
