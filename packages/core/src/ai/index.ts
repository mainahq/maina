import { join } from "node:path";
import { buildCacheKey, hashContent } from "../cache/keys";
import { type CacheManager, createCacheManager } from "../cache/manager";
import { getTtl } from "../cache/ttl";
import { NO_SPEND } from "../config/budget";
import {
	getApiKey,
	loadConfigModule,
	resolveProvider,
	shouldDelegateToHost,
} from "../config/index";
import type { Config } from "../config/schema";
import { getStatsDb } from "../db/index";
import { toDbPort } from "../db/port";
import { defaultDecidePorts } from "../decide/decide";
import type { ClockPort } from "../ports/clock";
import type { EnvPort } from "../ports/env";
import type { LogFields, LoggerPort, LogLevel } from "../ports/logger";
import { createDbLogger } from "./model-log";
import { routeTask } from "./routing";
import {
	createSpendLedger,
	currentSpendTask,
	DEFAULT_TIER_PRICES,
	type SpendLedgerPort,
	usageCostUsd,
} from "./spend";
import { chooseTier, type ModelTier } from "./tiers";
import { validateAIOutput } from "./validate";

/**
 * What every AI entry point needs from its caller: the repository root the
 * `maina.config.*` lookup starts from, and the environment that decides the
 * API key, provider and host delegation.
 */
export type AIContext = Readonly<{
	root: string;
	env: EnvPort;
}>;

type TokenCounts = { input: number; output: number };

type ModelCallRequest = Readonly<{
	modelId: string;
	provider: string;
	apiKey: string;
	system: string;
	user: string;
}>;

/** One provider call: its text and usage, or `null` on any failure. */
type ModelCall = (
	request: ModelCallRequest,
) => Promise<{ text: string; tokens?: TokenCounts } | null>;

interface GenerateOptions extends AIContext {
	task: string;
	systemPrompt: string;
	userPrompt: string;
	files?: string[]; // for cache key
	mainaDir?: string; // for cache storage; defaults to <root>/.maina
	/**
	 * Where spend is read from (for the budget caps) and recorded to.
	 * Defaults to the ledger in `<mainaDir>/stats.db`.
	 */
	ledger?: SpendLedgerPort;
	/**
	 * Receives the routing decision and its savings estimate. Defaults to
	 * the model log in `<mainaDir>/stats.db`.
	 */
	logger?: LoggerPort;
	/** The provider call; defaults to the AI SDK. A seam for tests. */
	callModel?: ModelCall;
}

interface GenerateResult {
	text: string;
	cached: boolean;
	model: string;
	tokens?: TokenCounts;
	slopWarnings?: string[];
	/**
	 * Set when the budget stopped the call before any model ran: the
	 * user-facing message (also in `text` for older callers). Never treat
	 * `text` as model output when this is set.
	 */
	budgetStop?: string;
}

interface StoredResult {
	text: string;
	model: string;
	tokens?: TokenCounts;
}

const ignoreLog = (): undefined => undefined;

/** When the model log cannot be opened: routing entries are dropped. */
const SILENT_LOGGER: LoggerPort = {
	debug: ignoreLog,
	info: ignoreLog,
	warn: ignoreLog,
	error: ignoreLog,
};

const systemClock: ClockPort = { now: () => Date.now() };

type SpendPorts = Readonly<{
	ledger: SpendLedgerPort | undefined;
	logger: LoggerPort;
	close: () => void;
}>;

/**
 * The caller's ledger and logger, with any left out opened on
 * `<mainaDir>/stats.db`. The budget fails open: when the store cannot be
 * opened there is no ledger (nothing counts as spent) and entries drop,
 * so a broken stats file never blocks AI features.
 */
function openSpendPorts(
	mainaDir: string,
	ledger: SpendLedgerPort | undefined,
	logger: LoggerPort | undefined,
): SpendPorts {
	if (ledger !== undefined && logger !== undefined) {
		return { ledger, logger, close: ignoreLog };
	}
	const opened = getStatsDb(mainaDir);
	if (!opened.ok) {
		return { ledger, logger: logger ?? SILENT_LOGGER, close: ignoreLog };
	}
	const ports = { db: toDbPort(opened.value.db), clock: systemClock };
	const ownLedger = ledger === undefined ? createSpendLedger(ports) : undefined;
	const ownLogger = logger === undefined ? createDbLogger(ports) : undefined;
	return {
		ledger: ledger ?? (ownLedger?.ok ? ownLedger.value : undefined),
		logger: logger ?? (ownLogger?.ok ? ownLogger.value : SILENT_LOGGER),
		close: () => opened.value.db.close(),
	};
}

/**
 * A logger that holds its entries until `flush` passes them to `target`,
 * so a routing decision that ends in a cache hit is never logged.
 */
function deferredLogger(target: LoggerPort): Readonly<{
	logger: LoggerPort;
	flush: () => void;
}> {
	const pending: Array<() => void> = [];
	const at =
		(level: LogLevel) =>
		(message: string, fields?: LogFields): void => {
			pending.push(() => target[level](message, fields));
		};
	return {
		logger: {
			debug: at("debug"),
			info: at("info"),
			warn: at("warn"),
			error: at("error"),
		},
		flush: () => {
			for (const entry of pending.splice(0)) entry();
		},
	};
}

/** The configured model for `tier`, mapped for the Anthropic provider. */
function modelIdFor(config: Config, tier: ModelTier, provider: string): string {
	const configured = config.models[tier];
	if (provider !== "anthropic") return configured;
	// In host mode with Anthropic, use a sensible model instead of OpenRouter model IDs
	if (configured.startsWith("google/")) return "claude-sonnet-4-20250514";
	return configured.includes("/")
		? (configured.split("/")[1] ?? configured)
		: configured;
}

/** The cached result under `key`, or `undefined` (a corrupt entry is a miss). */
function readCached(
	cache: CacheManager,
	key: string,
): GenerateResult | undefined {
	const cached = cache.get(key);
	if (cached === null) return undefined;
	try {
		const stored = JSON.parse(cached.value) as StoredResult;
		return {
			text: stored.text,
			cached: true,
			model: stored.model,
			tokens: stored.tokens,
		};
	} catch {
		return undefined;
	}
}

/**
 * Performs the actual AI SDK call. Tests pass their own `callModel`.
 * Returns null on any error so callers can handle gracefully.
 */
const callSdkModel: ModelCall = async ({
	modelId,
	provider,
	apiKey,
	system,
	user,
}) => {
	try {
		const { generateText } = await import("ai");
		const { createOpenAI } = await import("@ai-sdk/openai");

		// Provider-specific base URLs
		let baseURL: string | undefined;
		if (provider === "openrouter") {
			baseURL = "https://openrouter.ai/api/v1";
		} else if (provider === "anthropic") {
			baseURL = "https://api.anthropic.com/v1";
		}

		const openai = createOpenAI({
			apiKey,
			baseURL,
		});

		const result = await generateText({
			model: openai(modelId),
			system,
			prompt: user,
		});

		return {
			text: result.text,
			tokens:
				result.usage != null
					? {
							input: result.usage.inputTokens ?? 0,
							output: result.usage.outputTokens ?? 0,
						}
					: undefined,
		};
	} catch {
		return null;
	}
};

/**
 * Main AI generation function with cache-first strategy.
 *
 * 1. Hash the prompts and return a cached result for the task's tier if
 *    there is one: it costs nothing, so the budget never blocks it and it
 *    is neither routed nor charged.
 * 2. Route the task to a tier and enforce the budget against the spend
 *    ledger (today's spend and the running task's); a budget stop returns
 *    its message instead of calling a model.
 * 3. Delegate to the host, or, with no API key, return a helpful error
 *    result (never throw); neither is logged as routed.
 * 4. Log the routing decision, call the model, record its cost in the
 *    ledger, cache the result, and return it.
 */
export async function generate(
	options: GenerateOptions,
): Promise<GenerateResult> {
	const { task, systemPrompt, userPrompt, files, mainaDir, root, env } =
		options;

	const { config } = await loadConfigModule(root);
	const provider = resolveProvider(config, env);
	const promptHash = hashContent(systemPrompt + userPrompt);
	const cacheKeyFor = (model: string): Promise<string> =>
		buildCacheKey({ task, files, promptHash, model });

	// Set up cache (no-op manager if mainaDir not provided)
	const effectiveMainaDir = mainaDir ?? join(root, ".maina");
	const cache = createCacheManager(effectiveMainaDir);

	const preferredTier = chooseTier(defaultDecidePorts, task).tier;
	const hit = readCached(
		cache,
		await cacheKeyFor(modelIdFor(config, preferredTier, provider)),
	);
	if (hit !== undefined) return hit;

	const spendPorts = openSpendPorts(
		effectiveMainaDir,
		options.ledger,
		options.logger,
	);
	try {
		const { ledger, logger } = spendPorts;
		const taskId = currentSpendTask();
		const spent = ledger?.spend(taskId);
		if (spent !== undefined && !spent.ok) {
			logger.warn("spend ledger unreadable; budget sees no spend", {
				error: spent.error.message,
			});
		}
		const routing = deferredLogger(logger);
		const routed = routeTask(
			{ decide: defaultDecidePorts, logger: routing.logger },
			{
				task,
				budget: config.budget,
				spend: spent?.ok ? spent.value : NO_SPEND,
			},
		);
		if (!routed.ok) {
			routing.flush();
			const message = routed.error.message;
			return { text: message, cached: false, model: "", budgetStop: message };
		}
		const { tier, estimatedCostUsd } = routed.value;
		const modelId = modelIdFor(config, tier, provider);
		const cacheKey = await cacheKeyFor(modelId);
		// A degrade moved the task off its preferred tier: an answer cached on
		// the routed tier is free too, so it is served unrouted and uncharged.
		if (tier !== preferredTier) {
			const degradedHit = readCached(cache, cacheKey);
			if (degradedHit !== undefined) return degradedHit;
		}
		const ttl = getTtl(task as Parameters<typeof getTtl>[0]);

		// Host delegation: when running inside Claude Code/Cursor without own API key,
		// return the prompt so the host agent can process it via MCP or skills
		if (shouldDelegateToHost(env)) {
			const delegationText = `[HOST_DELEGATION] Task: ${task}\n\nSystem: ${systemPrompt}\n\nUser: ${userPrompt}`;
			// Cache the delegation prompt to avoid rebuilding on repeat calls
			const storedDelegation = { text: delegationText, model: "host" };
			cache.set(cacheKey, JSON.stringify(storedDelegation), {
				ttl,
				model: "host",
			});
			return {
				text: delegationText,
				cached: false,
				model: "host",
			};
		}

		// Check for API key
		const apiKey = getApiKey(env);
		if (apiKey === null) {
			return {
				text: "No API key found. Set MAINA_API_KEY or OPENROUTER_API_KEY environment variable to use AI features.",
				cached: false,
				model: "",
			};
		}

		// Only a call that reaches a model is logged as routed: host
		// delegation and the no-key path spend nothing on this tier.
		routing.flush();
		const aiResult = await (options.callModel ?? callSdkModel)({
			modelId,
			provider,
			apiKey,
			system: systemPrompt,
			user: userPrompt,
		});

		if (aiResult === null) {
			return {
				text: "AI call failed. Check your API key and network connection.",
				cached: false,
				model: modelId,
			};
		}

		// Charge the call: its reported usage at the tier's price, else the estimate.
		const recorded = ledger?.record({
			taskId,
			task,
			tier,
			model: modelId,
			inputTokens: aiResult.tokens?.input ?? 0,
			outputTokens: aiResult.tokens?.output ?? 0,
			costUsd:
				aiResult.tokens === undefined
					? estimatedCostUsd
					: usageCostUsd(aiResult.tokens, DEFAULT_TIER_PRICES[tier]),
		});
		if (recorded !== undefined && !recorded.ok) {
			logger.warn("spend ledger write failed", {
				error: recorded.error.message,
			});
		}

		// Store in cache
		const storedResult: StoredResult = {
			text: aiResult.text,
			model: modelId,
			tokens: aiResult.tokens,
		};
		cache.set(cacheKey, JSON.stringify(storedResult), { ttl, model: modelId });

		// Validate AI output for slop patterns
		const validation = validateAIOutput(aiResult.text);

		return {
			text: validation.sanitized,
			cached: false,
			model: modelId,
			tokens: aiResult.tokens,
			slopWarnings:
				validation.warnings.length > 0 ? validation.warnings : undefined,
		};
	} finally {
		spendPorts.close();
	}
}
