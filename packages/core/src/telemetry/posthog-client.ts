/**
 * PostHog send path — the missing link between `buildUsageEvent` /
 * `buildErrorEvent` and PostHog EU.
 *
 * Hard contract:
 * - Consent gate is authoritative. Unless the effective collection config
 *   (see `./consent`) opts in to `usage`, `captureUsage` is a no-op; same
 *   for `crash_reports` and `captureError`. The two channels are
 *   independent, and a consent read error means "off".
 * - Build-time key gate is also authoritative. If `MAINA_POSTHOG_API_KEY`
 *   is unset (OSS fork, dev build), we never import the SDK and every
 *   capture is a no-op. No warning, no throw.
 * - SDK import is lazy — `import("posthog-node")` fires on the first
 *   green-lit capture only. Zero startup cost when telemetry is off.
 * - Capture is fire-and-forget. Commands never await a capture call.
 * - Flush has a bounded budget. A dead PostHog endpoint cannot hang
 *   `maina commit` beyond the budget.
 */

import type { EnvPort } from "../ports/env";
import type { FsPort } from "../ports/fs";
import { loadCollectionConfig, type TelemetryContext } from "./consent";
import type { ErrorEvent } from "./reporter";
import type { UsageEvent } from "./usage";

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

/** Builds the SDK for `apiKey`, sending to `host` (resolved from the env). */
export type PosthogFactory = (apiKey: string, host: string) => PosthogLike;

export interface PosthogClientOptions {
	/**
	 * Environment for the API key (`MAINA_POSTHOG_API_KEY`), host
	 * (`MAINA_POSTHOG_HOST`) and device fingerprint (`MAINA_DEVICE_FINGERPRINT`).
	 */
	env: EnvPort;
	/**
	 * Filesystem the opt-ins are read through. Without it (and without
	 * `consent`) nothing is ever captured.
	 */
	fs?: FsPort;
	/** Repo root whose policy may opt out. */
	root?: string;
	/** DI seam for tests. Production default dynamic-imports `posthog-node`. */
	createPosthog?: PosthogFactory;
	/** Override the build-inlined key (tests). Empty string → disabled. */
	apiKeyOverride?: string;
	/** Override consent checks (tests). Otherwise read through `fs`. */
	consent?: { usage: boolean; errors: boolean };
}

export interface PosthogClient {
	captureUsage(event: UsageEvent): void;
	captureError(event: ErrorEvent): void;
	flush(budgetMs?: number): Promise<void>;
}

const DEFAULT_FLUSH_BUDGET_MS = 2_000;
const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

function readApiKey(env: EnvPort, override?: string): string {
	if (override !== undefined) return override;
	// Runtime-reading through the injected env for now; when the build lands
	// the edge can inline `MAINA_POSTHOG_API_KEY` so the key is a literal in
	// the prod bundle.
	return env.get("MAINA_POSTHOG_API_KEY") ?? "";
}

type Consent = Readonly<{ usage: boolean; errors: boolean }>;

const NO_CONSENT: Consent = { usage: false, errors: false };

async function readConsent(opts: PosthogClientOptions): Promise<Consent> {
	if (opts.fs === undefined) return NO_CONSENT;
	const config = await loadCollectionConfig({
		fs: opts.fs,
		env: opts.env,
		...(opts.root === undefined ? {} : { root: opts.root }),
	});
	if (!config.ok) return NO_CONSENT;
	return {
		usage: config.value.channels.usage.enabled,
		errors: config.value.channels.crash_reports.enabled,
	};
}

/**
 * Default distinct-id seed. We intentionally do NOT derive from the user's
 * real identity — PostHog cohort-level analytics doesn't need it, and the
 * event shapes are already PII-scrubbed. A per-install random ID means two
 * developers on the same machine still register as separate users.
 */
function distinctIdSeed(env: EnvPort): string {
	// Piggyback on whatever setup wrote — `~/.maina/config.yml` stores a
	// device fingerprint if the user opted in. Until the fingerprint reader
	// lands here we fall back to a hostname+pid hash equivalent. Kept
	// deliberately dumb; a follow-up can tighten this.
	const fp = env.get("MAINA_DEVICE_FINGERPRINT") ?? "anon";
	return `maina:${fp}`;
}

export function createPosthogClient(opts: PosthogClientOptions): PosthogClient {
	const { env } = opts;
	const apiKey = readApiKey(env, opts.apiKeyOverride);
	const host = env.get("MAINA_POSTHOG_HOST") ?? DEFAULT_POSTHOG_HOST;
	const hasKey = apiKey.length > 0;
	let sdk: PosthogLike | null = null;
	let sdkAttempted = false;

	function getSdk(): PosthogLike | null {
		if (sdkAttempted) return sdk;
		sdkAttempted = true;
		if (!hasKey) return null;
		try {
			const factory = opts.createPosthog ?? defaultFactory;
			sdk = factory(apiKey, host);
		} catch {
			sdk = null;
		}
		return sdk;
	}

	// Consent reads still in flight; `flush` waits for them.
	const pending = new Set<Promise<void>>();

	/**
	 * Runs `send` once `kind` is known to be opted in: synchronously with a
	 * `consent` override, otherwise after reading the config through the
	 * ports. Without a key nothing could be sent, so nothing is read.
	 */
	function whenConsented(kind: keyof Consent, send: () => void): void {
		if (!hasKey) return;
		if (opts.consent) {
			if (opts.consent[kind]) send();
			return;
		}
		const read: Promise<void> = readConsent(opts)
			.then((consent) => {
				if (consent[kind]) send();
			})
			.catch(() => {
				// A failed consent read means "off".
			})
			.finally(() => {
				pending.delete(read);
			});
		pending.add(read);
	}

	function captureUsage(event: UsageEvent): void {
		whenConsented("usage", () => sendUsage(event));
	}

	function captureError(event: ErrorEvent): void {
		whenConsented("errors", () => sendError(event));
	}

	function sendUsage(event: UsageEvent): void {
		const client = getSdk();
		if (!client) return;
		try {
			client.capture({
				distinctId: distinctIdSeed(env),
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

	function sendError(event: ErrorEvent): void {
		const client = getSdk();
		if (!client) return;
		try {
			client.captureException({
				distinctId: distinctIdSeed(env),
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
		if (!sdk && pending.size === 0) return;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, budgetMs);
		});
		const drain = async (): Promise<void> => {
			await Promise.allSettled([...pending]);
			if (!sdk) return;
			await sdk.shutdown().catch(() => {
				// shutdown failed; treat as drained
			});
		};
		try {
			await Promise.race([drain(), timeout]);
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
async function loadRealSdk(
	apiKey: string,
	host: string,
): Promise<PosthogLike | null> {
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
function defaultFactory(apiKey: string, host: string): PosthogLike {
	const pending: Promise<PosthogLike | null> = loadRealSdk(apiKey, host);
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

/**
 * Lazy singleton, built from the context of the first capture and cached
 * after that (the edge passes the same context every time). Tests should
 * call `createPosthogClient` directly.
 */
function getSingleton(ctx: TelemetryContext): PosthogClient {
	if (singleton === null) singleton = createPosthogClient(ctx);
	return singleton;
}

export function captureUsage(event: UsageEvent, ctx: TelemetryContext): void {
	getSingleton(ctx).captureUsage(event);
}

export function captureError(event: ErrorEvent, ctx: TelemetryContext): void {
	getSingleton(ctx).captureError(event);
}

/** Drain queued captures. A no-op when nothing was ever captured. */
export function flushTelemetry(
	budgetMs: number = DEFAULT_FLUSH_BUDGET_MS,
): Promise<void> {
	return singleton === null ? Promise.resolve() : singleton.flush(budgetMs);
}
