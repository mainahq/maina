/**
 * Observer ports (#591): a write in core hands what it stored to an
 * optional callback, so the runtime can act on it (the Link uplink) while
 * core stays free of network calls. An observer sees a write only after it
 * succeeded, and can neither undo it nor fail it.
 */

/** Called with each value a write stored. */
export type ObserverPort<T> = (value: T) => void;

/** Hands `value` to `port`, if any; a port that throws is ignored. */
export function notify<T>(port: ObserverPort<T> | undefined, value: T): void {
	if (port === undefined) return;
	try {
		port(value);
	} catch {
		// The observer's failure is its own: the write it observes stands.
	}
}
