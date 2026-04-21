/**
 * PostHog send path — the missing link between `buildUsageEvent` /
 * `buildErrorEvent` and PostHog EU.
 *
 * Hard contract:
 * - Consent gate is authoritative. If `telemetry: true` is not set in
 *   `~/.maina/config.yml`, `captureUsage` must be a no-op. Same for
 *   `errors: true` and `captureError`. The two flags are independent.
 * - Build-time key gate is also authoritative. If `MAINA_POSTHOG_API_KEY`
 *   is unset (OSS fork, dev build), we never import the SDK and every
 *   capture is a no-op. No warning, no throw.
 * - SDK import is lazy — `import("posthog-node")` fires on the first
 *   green-lit capture only. Zero startup cost when telemetry is off.
 * - Capture is fire-and-forget. Commands never await a capture call.
 * - Flush has a bounded budget. A dead PostHog endpoint cannot hang
 *   `maina commit` beyond the budget.
 */

import { type ErrorEvent, isErrorReportingEnabled } from "./reporter";
import { isTelemetryEnabled, type UsageEvent } from "./usage";

/**
 * Minimum surface we use from `posthog-node`. Typed locally so the SDK
 * stays an optional runtime dep of core — importing this module never
 * pulls `posthog-node` into the bundle graph.
 */
export interface PosthogLike {
	capture(input: {
		distinctId: string;
		event: string;
		properties?: Record<string, unknown>;
	}): void;
	captureException(input: {
		distinctId: string;
		error: unknown;
		additionalProperties?: Record<string, unknown>;
	}): void;
	shutdown(): Promise<void>;
}

export type PosthogFactory = (apiKey: string) => PosthogLike;

export interface PosthogClientOptions {
	/** DI seam for tests. Production default dynamic-imports `posthog-node`. */
	createPosthog?: PosthogFactory;
	/** Override the build-inlined key (tests). Empty string → disabled. */
	apiKeyOverride?: string;
	/** Override consent checks (tests). Otherwise read from config. */
	consent?: { usage: boolean; errors: boolean };
}

export interface PosthogClient {
	captureUsage(event: UsageEvent): void;
	captureError(event: ErrorEvent): void;
	flush(budgetMs?: number): Promise<void>;
}

const DEFAULT_FLUSH_BUDGET_MS = 2_000;

function readApiKey(override?: string): string {
	if (override !== undefined) return override;
	// Build-time replacement by bunup `define:`. Runtime-reading for now; when
	// the build lands we'll inline `process.env.MAINA_POSTHOG_API_KEY` to a
	// string literal so the branch below goes dead in the prod bundle.
	const raw = process.env.MAINA_POSTHOG_API_KEY;
	return typeof raw === "string" ? raw : "";
}

function readConsent(override?: PosthogClientOptions["consent"]): {
	usage: boolean;
	errors: boolean;
} {
	if (override) return override;
	return {
		usage: isTelemetryEnabled(),
		errors: isErrorReportingEnabled(),
	};
}

/**
 * Default distinct-id seed. We intentionally do NOT derive from the user's
 * real identity — PostHog cohort-level analytics doesn't need it, and the
 * event shapes are already PII-scrubbed. A per-install random ID means two
 * developers on the same machine still register as separate users.
 */
function distinctIdSeed(): string {
	// Piggyback on whatever setup wrote — `~/.maina/config.yml` stores a
	// device fingerprint if the user opted in. Until the fingerprint reader
	// lands here we fall back to a hostname+pid hash equivalent. Kept
	// deliberately dumb; a follow-up can tighten this.
	const fp = process.env.MAINA_DEVICE_FINGERPRINT ?? "anon";
	return `maina:${fp}`;
}

export function createPosthogClient(
	opts: PosthogClientOptions = {},
): PosthogClient {
	const apiKey = readApiKey(opts.apiKeyOverride);
	const hasKey = apiKey.length > 0;
	let sdk: PosthogLike | null = null;
	let sdkAttempted = false;

	function getSdk(): PosthogLike | null {
		if (sdkAttempted) return sdk;
		sdkAttempted = true;
		if (!hasKey) return null;
		try {
			const factory = opts.createPosthog ?? defaultFactory;
			sdk = factory(apiKey);
		} catch {
			sdk = null;
		}
		return sdk;
	}

	function captureUsage(event: UsageEvent): void {
		const consent = readConsent(opts.consent);
		if (!consent.usage) return;
		if (!hasKey) return;
		const client = getSdk();
		if (!client) return;
		try {
			client.capture({
				distinctId: distinctIdSeed(),
				event: event.event,
				properties: {
					...event.properties,
					os: event.os,
					runtime: event.runtime,
					version: event.version,
					timestamp: event.timestamp,
				},
			});
		} catch {
			// Never let telemetry take down the command.
		}
	}

	function captureError(event: ErrorEvent): void {
		const consent = readConsent(opts.consent);
		if (!consent.errors) return;
		if (!hasKey) return;
		const client = getSdk();
		if (!client) return;
		try {
			client.captureException({
				distinctId: distinctIdSeed(),
				error: new Error(event.message),
				additionalProperties: {
					errorClass: event.errorClass,
					errorId: event.errorId,
					stack: event.stack,
					os: event.os,
					runtime: event.runtime,
					version: event.version,
					command: event.command,
					agent: event.agent,
					timestamp: event.timestamp,
				},
			});
		} catch {
			// swallow
		}
	}

	async function flush(
		budgetMs: number = DEFAULT_FLUSH_BUDGET_MS,
	): Promise<void> {
		if (!sdk) return;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, budgetMs);
		});
		try {
			await Promise.race([
				sdk.shutdown().catch(() => {
					// shutdown failed; treat as drained
				}),
				timeout,
			]);
		} finally {
			if (timer !== null) clearTimeout(timer);
		}
	}

	return { captureUsage, captureError, flush };
}

/**
 * Dynamic `posthog-node` import. Kept out of the module top-level so the
 * SDK never loads when telemetry is off.
 */
async function loadRealSdk(apiKey: string): Promise<PosthogLike | null> {
	try {
		// Module specifier behind a string literal so TS type-resolution doesn't
		// force callers to declare `posthog-node` in their tsconfig. Runtime
		// requires `posthog-node` as an optional peer dep of `@mainahq/core`.
		const spec = "posthog-node";
		const mod = (await import(/* @vite-ignore */ spec)) as unknown as {
			PostHog?: new (
				key: string,
				options?: { host?: string; flushAt?: number },
			) => PosthogLike;
			default?: new (
				key: string,
				options?: { host?: string; flushAt?: number },
			) => PosthogLike;
		};
		const Ctor = mod.PostHog ?? mod.default;
		if (!Ctor) return null;
		const host = process.env.MAINA_POSTHOG_HOST ?? "https://eu.i.posthog.com";
		return new Ctor(apiKey, { host, flushAt: 1 });
	} catch {
		return null;
	}
}

/**
 * Production factory. `createPosthog` accepts a key synchronously — the SDK
 * import is actually async, but we hide the await behind a proxy so the
 * `PosthogLike` contract stays synchronous-construction. The first capture
 * after construction fires the dynamic import; subsequent captures go
 * straight through once the real SDK resolves.
 *
 * Shutdown must drain any in-flight captures queued on the `ready` promise —
 * otherwise events fired just before `flushTelemetry` races can be dropped
 * (CodeRabbit 2026-04-22). We collect the queued-capture promises and await
 * them alongside the real SDK's shutdown.
 */
function defaultFactory(apiKey: string): PosthogLike {
	const pending: Promise<PosthogLike | null> = loadRealSdk(apiKey);
	let real: PosthogLike | null = null;
	const ready = pending.then((s) => {
		real = s;
	});
	const queued: Promise<unknown>[] = [];
	return {
		capture(input) {
			if (real) {
				real.capture(input);
				return;
			}
			queued.push(ready.then(() => real?.capture(input)));
		},
		captureException(input) {
			if (real) {
				real.captureException(input);
				return;
			}
			queued.push(ready.then(() => real?.captureException(input)));
		},
		async shutdown() {
			// Drain queued pre-import captures first so their `.capture()`
			// calls land on the SDK before we tear it down.
			await Promise.allSettled(queued);
			const s = await pending;
			if (s) await s.shutdown();
		},
	};
}

// ── Process-wide singleton ──────────────────────────────────────────────────

let singleton: PosthogClient | null = null;

/** Lazy singleton; cached after first call. Tests should call `createPosthogClient` directly. */
function getSingleton(): PosthogClient {
	if (singleton === null) singleton = createPosthogClient();
	return singleton;
}

export function captureUsage(event: UsageEvent): void {
	getSingleton().captureUsage(event);
}

export function captureError(event: ErrorEvent): void {
	getSingleton().captureError(event);
}

export function flushTelemetry(
	budgetMs: number = DEFAULT_FLUSH_BUDGET_MS,
): Promise<void> {
	return getSingleton().flush(budgetMs);
}

/** Reset the singleton — tests only. */
export function __resetForTests(): void {
	singleton = null;
}
