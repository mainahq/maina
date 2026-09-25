import type { Result } from "../db/index";

/** One outbound POST. The body is already-serialised JSON. */
export type NetworkRequest = Readonly<{
	url: string;
	body: string;
	headers: Readonly<Record<string, string>>;
	/** Hard cap on the round trip; the adapter aborts past it. */
	timeoutMs: number;
}>;

export type NetworkError =
	| Readonly<{ kind: "timeout"; url: string }>
	| Readonly<{ kind: "http"; url: string; status: number }>
	| Readonly<{ kind: "network"; url: string; message: string }>;

/**
 * Outbound network access for telemetry and sharing (FR-PRIV-1). Every byte
 * core sends off the machine goes through this port, so a spy proves what is
 * (and is not) sent. Adapters never throw: failures come back as `Result`.
 */
export type NetworkPort = Readonly<{
	post: (
		request: NetworkRequest,
	) => Promise<Result<Readonly<{ status: number }>, NetworkError>>;
}>;
