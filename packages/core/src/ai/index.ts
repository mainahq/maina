import { buildCacheKey, hashContent } from "../cache/keys";
import { createCacheManager } from "../cache/manager";
import { getTtl } from "../cache/ttl";
import {
	getApiKey,
	loadConfig,
	resolveProvider,
	shouldDelegateToHost,
} from "../config/index";
import { resolveModel } from "./tiers";
import { validateAIOutput } from "./validate";

export interface GenerateOptions {
	task: string;
	systemPrompt: string;
	userPrompt: string;
	files?: string[]; // for cache key
	mainaDir?: string; // for cache storage
}

export interface GenerateResult {
	text: string;
	cached: boolean;
	model: string;
	tokens?: { input: number; output: number };
	slopWarnings?: string[];
}

interface StoredResult {
	text: string;
	model: string;
	tokens?: { input: number; output: number };
}

/**
 * Performs the actual AI SDK call. Isolated here so tests never need to invoke it.
 * Returns null on any error so callers can handle gracefully.
 */
export async function callModel(
	modelId: string,
	provider: string,
	apiKey: string,
	system: string,
	user: string,
): Promise<{
	text: string;
	tokens?: { input: number; output: number };
} | null> {
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
}

/**
 * Main AI generation function with cache-first strategy.
 *
 * 1. Hash the prompts to build a stable cache key.
 * 2. Return cached result if available.
 * 3. If no API key, return a helpful error result (never throw).
 * 4. Call the model, cache the result, and return it.
 */
export async function generate(
	options: GenerateOptions,
): Promise<GenerateResult> {
	const { task, systemPrompt, userPrompt, files, mainaDir } = options;

	const config = await loadConfig();
	const resolved = resolveModel(task, config);
	const provider = resolveProvider(config);
	// In host mode with Anthropic, use a sensible model instead of OpenRouter model IDs
	const modelId =
		provider === "anthropic" && resolved.modelId.startsWith("google/")
			? "claude-sonnet-4-20250514"
			: provider === "anthropic" && resolved.modelId.includes("/")
				? (resolved.modelId.split("/")[1] ?? resolved.modelId)
				: resolved.modelId;

	// Build cache key
	const promptHash = hashContent(systemPrompt + userPrompt);
	const cacheKey = await buildCacheKey({
		task,
		files,
		promptHash,
		model: modelId,
	});

	// Set up cache (no-op manager if mainaDir not provided)
	const effectiveMainaDir = mainaDir ?? ".maina";
	const cache = createCacheManager(effectiveMainaDir);

	// Cache hit
	const cached = cache.get(cacheKey);
	if (cached !== null) {
		try {
			const stored = JSON.parse(cached.value) as StoredResult;
			return {
				text: stored.text,
				cached: true,
				model: stored.model,
				tokens: stored.tokens,
			};
		} catch {
			// Corrupted cache entry — fall through to re-generate
		}
	}

	// Host delegation: when running inside Claude Code/Cursor without own API key,
	// return the prompt so the host agent can process it via MCP or skills
	if (shouldDelegateToHost()) {
		return {
			text: `[HOST_DELEGATION] Task: ${task}\n\nSystem: ${systemPrompt}\n\nUser: ${userPrompt}`,
			cached: false,
			model: "host",
		};
	}

	// Check for API key
	const apiKey = getApiKey();
	if (apiKey === null) {
		return {
			text: "No API key found. Set MAINA_API_KEY or OPENROUTER_API_KEY environment variable to use AI features.",
			cached: false,
			model: "",
		};
	}

	// Call the model
	const aiResult = await callModel(
		modelId,
		provider,
		apiKey,
		systemPrompt,
		userPrompt,
	);

	if (aiResult === null) {
		return {
			text: "AI call failed. Check your API key and network connection.",
			cached: false,
			model: modelId,
		};
	}

	// Store in cache
	const ttl = getTtl(task as Parameters<typeof getTtl>[0]);
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
}
