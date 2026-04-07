/**
 * AI Delegation Protocol — structured stdout protocol for host agents.
 *
 * When maina runs inside Claude Code/Codex/OpenCode without an API key,
 * AI-dependent steps output request blocks that the host agent can
 * parse and process with its own AI.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface DelegationRequest {
	task: string;
	context: string;
	prompt: string;
	expectedFormat: "json" | "markdown" | "text";
	schema?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────

const START_MARKER = "---MAINA_AI_REQUEST---";
const END_MARKER = "---END_MAINA_AI_REQUEST---";

// ─── Format ───────────────────────────────────────────────────────────────

/**
 * Format a delegation request as a structured text block.
 * This block is output to stdout for host agents to parse.
 */
export function formatDelegationRequest(req: DelegationRequest): string {
	const lines: string[] = [START_MARKER];
	lines.push(`task: ${req.task}`);
	lines.push(`context: ${req.context}`);
	lines.push(`expected_format: ${req.expectedFormat}`);
	if (req.schema) {
		lines.push(`schema: ${req.schema}`);
	}
	lines.push("prompt: |");
	// Indent prompt lines by 2 spaces (YAML-style block scalar)
	for (const line of req.prompt.split("\n")) {
		lines.push(`  ${line}`);
	}
	lines.push(END_MARKER);
	return lines.join("\n");
}

// ─── Parse ────────────────────────────────────────────────────────────────

/**
 * Parse a delegation request block from text.
 * Returns null if the text doesn't contain a valid request block.
 */
export function parseDelegationRequest(text: string): DelegationRequest | null {
	const startIdx = text.indexOf(START_MARKER);
	const endIdx = text.indexOf(END_MARKER);
	if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
		return null;
	}

	const block = text.slice(startIdx + START_MARKER.length, endIdx).trim();
	const lines = block.split("\n");

	let task = "";
	let context = "";
	let expectedFormat: DelegationRequest["expectedFormat"] = "text";
	let schema: string | undefined;
	const promptLines: string[] = [];
	let inPrompt = false;

	for (const line of lines) {
		if (inPrompt) {
			// Prompt lines are indented by 2 spaces
			promptLines.push(line.startsWith("  ") ? line.slice(2) : line);
			continue;
		}

		if (line.startsWith("task: ")) {
			task = line.slice(6).trim();
		} else if (line.startsWith("context: ")) {
			context = line.slice(9).trim();
		} else if (line.startsWith("expected_format: ")) {
			const fmt = line.slice(17).trim();
			if (fmt === "json" || fmt === "markdown" || fmt === "text") {
				expectedFormat = fmt;
			}
		} else if (line.startsWith("schema: ")) {
			schema = line.slice(8).trim();
		} else if (line.startsWith("prompt: |")) {
			inPrompt = true;
		}
	}

	if (!task) return null;

	return {
		task,
		context,
		prompt: promptLines.join("\n").trim(),
		expectedFormat,
		schema,
	};
}

/**
 * Output a delegation request to stderr.
 * Only outputs when running inside an AI tool that can process it
 * (detected via CLAUDE_CODE, CURSOR, or similar env vars).
 * Silent in bare terminal to avoid confusing users.
 */
export function outputDelegationRequest(req: DelegationRequest): void {
	// Never output in MCP mode — corrupts JSON-RPC communication
	if (process.env.MAINA_MCP_SERVER === "1") {
		return;
	}

	// Only output in bare CLI when inside an AI tool that can process it
	const inAITool =
		process.env.CLAUDE_CODE === "1" ||
		process.env.CLAUDE_PROJECT_DIR ||
		process.env.CURSOR_TRACE_ID ||
		process.env.CONTINUE_GLOBAL_DIR;

	if (!inAITool) {
		return;
	}

	const formatted = formatDelegationRequest(req);
	process.stderr.write(`\n${formatted}\n`);
}
