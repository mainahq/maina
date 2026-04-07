/**
 * MCP result capture — connects tool outputs to cache, feedback, and stats.
 * This is the core of the round-trip flywheel.
 */

import { hashContent } from "../cache/keys";
import { createCacheManager } from "../cache/manager";
import { trackToolUsage } from "../stats/tracker";
import { recordFeedback } from "./collector";

export interface CaptureInput {
	tool: string;
	input: Record<string, unknown>;
	output: string;
	promptHash?: string;
	durationMs: number;
	mainaDir: string;
	workflowId?: string;
}

export function buildToolCacheKey(
	tool: string,
	input: Record<string, unknown>,
): string {
	const inputHash = hashContent(JSON.stringify(input));
	return hashContent(`mcp:${tool}:${inputHash}`);
}

export function getCachedResult(
	tool: string,
	input: Record<string, unknown>,
	mainaDir: string,
): string | null {
	try {
		const cache = createCacheManager(mainaDir);
		const key = buildToolCacheKey(tool, input);
		const entry = cache.get(key);
		if (entry !== null) {
			const inputHash = hashContent(JSON.stringify(input));
			trackToolUsage(mainaDir, {
				tool,
				inputHash,
				durationMs: 0,
				cacheHit: true,
			});
			return entry.value;
		}
		return null;
	} catch {
		return null;
	}
}

export function captureResult(input: CaptureInput): void {
	const inputHash = hashContent(JSON.stringify(input.input));

	// 1. Cache (synchronous — fast SQLite write)
	try {
		const cache = createCacheManager(input.mainaDir);
		const key = buildToolCacheKey(input.tool, input.input);
		cache.set(key, input.output, { ttl: 0 });
	} catch {
		// Cache failure is non-fatal
	}

	// 2. Feedback (fire-and-forget via microtask)
	queueMicrotask(() => {
		try {
			recordFeedback(input.mainaDir, {
				promptHash: input.promptHash ?? `${input.tool}-mcp`,
				task: input.tool,
				accepted: true,
				timestamp: new Date().toISOString(),
			});
		} catch {
			// Never throw from background feedback
		}
	});

	// 3. Stats (synchronous — fast SQLite write)
	try {
		trackToolUsage(input.mainaDir, {
			tool: input.tool,
			inputHash,
			durationMs: input.durationMs,
			cacheHit: false,
			workflowId: input.workflowId,
		});
	} catch {
		// Stats failure is non-fatal
	}
}
