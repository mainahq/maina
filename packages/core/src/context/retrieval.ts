export interface SearchResult {
	filePath: string;
	line: number;
	content: string;
	matchLength: number;
}

export interface RetrievalOptions {
	maxResults?: number; // default 20
	tokenBudget?: number; // max tokens for results
	cwd?: string;
}

/**
 * Check if a CLI tool is available by trying to run it with --version.
 * Uses --version instead of `which` because tools may be shell functions
 * (e.g., Claude Code wraps rg as a function).
 */
export async function isToolAvailable(tool: string): Promise<boolean> {
	try {
		const proc = Bun.spawn([tool, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Parse ripgrep JSON output (rg --json) into SearchResult[].
 * Each line is a JSON object; we only care about lines with type "match".
 */
function parseRipgrepJson(output: string): SearchResult[] {
	const results: SearchResult[] = [];
	const lines = output.split("\n");
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const obj = JSON.parse(line);
			if (obj.type !== "match") continue;
			const data = obj.data;
			const filePath: string = data?.path?.text ?? "";
			const lineNumber: number = data?.line_number ?? 0;
			const content: string = (data?.lines?.text ?? "").replace(/\n$/, "");
			// matchLength: sum of all submatches lengths
			let matchLength = 0;
			if (Array.isArray(data?.submatches)) {
				for (const sub of data.submatches) {
					if (typeof sub?.match?.text === "string") {
						matchLength += (sub.match.text as string).length;
					}
				}
			}
			if (filePath && lineNumber) {
				results.push({ filePath, line: lineNumber, content, matchLength });
			}
		} catch {
			// skip malformed lines
		}
	}
	return results;
}

/**
 * Parse plain `rg -n` or `grep -rn` output (format: filePath:lineNum:content).
 */
function parsePlainOutput(output: string): SearchResult[] {
	const results: SearchResult[] = [];
	const lines = output.split("\n");
	for (const line of lines) {
		if (!line.trim()) continue;
		// Format: filePath:lineNumber:content
		const firstColon = line.indexOf(":");
		if (firstColon === -1) continue;
		const afterFirst = line.indexOf(":", firstColon + 1);
		if (afterFirst === -1) continue;
		const filePath = line.slice(0, firstColon);
		const lineNum = Number.parseInt(line.slice(firstColon + 1, afterFirst), 10);
		const content = line.slice(afterFirst + 1);
		if (filePath && !Number.isNaN(lineNum)) {
			results.push({ filePath, line: lineNum, content, matchLength: 0 });
		}
	}
	return results;
}

/**
 * Parse Zoekt search output into SearchResult[].
 * Zoekt outputs in format: filePath:lineNum:content
 * Similar to grep/rg plain output but may include header lines.
 */
export function parseZoektOutput(output: string): SearchResult[] {
	const results: SearchResult[] = [];
	const lines = output.split("\n");
	for (const line of lines) {
		if (!line.trim()) continue;
		// Skip Zoekt header lines (e.g., "Repository: name")
		if (!line.includes(":") || line.startsWith("Repository:")) continue;
		const firstColon = line.indexOf(":");
		if (firstColon === -1) continue;
		const afterFirst = line.indexOf(":", firstColon + 1);
		if (afterFirst === -1) continue;
		const filePath = line.slice(0, firstColon);
		const lineNum = Number.parseInt(line.slice(firstColon + 1, afterFirst), 10);
		const content = line.slice(afterFirst + 1);
		if (filePath && !Number.isNaN(lineNum) && lineNum > 0) {
			results.push({ filePath, line: lineNum, content, matchLength: 0 });
		}
	}
	return results;
}

/**
 * Search using Zoekt (Google's code search).
 * Zoekt provides fast indexed search across the entire repo.
 * Falls back gracefully if zoekt is not available.
 */
export async function searchWithZoekt(
	query: string,
	options: RetrievalOptions,
): Promise<SearchResult[]> {
	const cwd = options.cwd ?? process.cwd();
	const maxResults = options.maxResults ?? 20;

	const zoektAvailable = await isToolAvailable("zoekt");
	if (!zoektAvailable) {
		return [];
	}

	try {
		const proc = Bun.spawn(["zoekt", "-n", String(maxResults), query], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		return parseZoektOutput(output);
	} catch {
		return [];
	}
}

/**
 * Search using ripgrep (rg). Uses --json format if available.
 * Respects .gitignore. Excludes node_modules, dist, .git.
 */
export async function searchWithRipgrep(
	query: string,
	options: RetrievalOptions,
): Promise<SearchResult[]> {
	const cwd = options.cwd ?? process.cwd();
	const maxResults = options.maxResults ?? 20;

	try {
		// Try JSON mode first (rg --json)
		const proc = Bun.spawn(
			[
				"rg",
				"--json",
				"--max-count",
				String(maxResults),
				"--glob",
				"!node_modules",
				"--glob",
				"!dist",
				"--glob",
				"!.git",
				query,
			],
			{
				cwd,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		return parseRipgrepJson(output);
	} catch {
		// Try plain mode (rg -n)
		try {
			const proc = Bun.spawn(
				[
					"rg",
					"-n",
					"--max-count",
					String(maxResults),
					"--glob",
					"!node_modules",
					"--glob",
					"!dist",
					"--glob",
					"!.git",
					query,
				],
				{
					cwd,
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const output = await new Response(proc.stdout).text();
			await proc.exited;
			return parsePlainOutput(output);
		} catch {
			return [];
		}
	}
}

/**
 * Fallback search using grep.
 * Searches .ts, .js, .tsx, .jsx files. Excludes node_modules, dist, .git.
 */
export async function searchWithGrep(
	query: string,
	options: RetrievalOptions,
): Promise<SearchResult[]> {
	const cwd = options.cwd ?? process.cwd();
	const maxResults = options.maxResults ?? 20;

	try {
		const proc = Bun.spawn(
			[
				"grep",
				"-rn",
				"-E",
				"--include=*.ts",
				"--include=*.tsx",
				"--include=*.js",
				"--include=*.jsx",
				"--include=*.py",
				"--include=*.go",
				"--include=*.rs",
				"--include=*.cs",
				"--include=*.java",
				"--include=*.kt",
				"--exclude-dir=node_modules",
				"--exclude-dir=dist",
				"--exclude-dir=.git",
				query,
				".",
			],
			{
				cwd,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const output = await new Response(proc.stdout).text();
		await proc.exited;
		const results = parsePlainOutput(output);
		return results.slice(0, maxResults);
	} catch {
		return [];
	}
}

/**
 * Approximate token count for a string (~1 token per 3.5 chars).
 */
function countTokens(text: string): number {
	return Math.ceil(text.length / 3.5);
}

/**
 * Search for a query using ripgrep (preferred) or grep (fallback).
 * Limits results by maxResults and optionally by tokenBudget.
 */
export async function search(
	query: string,
	options: RetrievalOptions = {},
): Promise<SearchResult[]> {
	const maxResults = options.maxResults ?? 20;
	const tokenBudget = options.tokenBudget;

	let results: SearchResult[] = [];

	try {
		// Try Zoekt first (indexed, fastest), then rg, then grep
		const zoektResults = await searchWithZoekt(query, options);
		if (zoektResults.length > 0) {
			results = zoektResults;
		} else {
			const rgAvailable = await isToolAvailable("rg");
			if (rgAvailable) {
				results = await searchWithRipgrep(query, options);
			} else {
				results = await searchWithGrep(query, options);
			}
		}
	} catch {
		return [];
	}

	// Enforce maxResults
	results = results.slice(0, maxResults);

	// Enforce tokenBudget if specified
	if (tokenBudget !== undefined) {
		let usedTokens = 0;
		const budgeted: SearchResult[] = [];
		for (const result of results) {
			const tokens = countTokens(
				`${result.filePath}:${result.line}: ${result.content}`,
			);
			if (usedTokens + tokens > tokenBudget) break;
			budgeted.push(result);
			usedTokens += tokens;
		}
		return budgeted;
	}

	return results;
}

/**
 * Format search results as text for LLM consumption.
 * Each result is formatted as "filePath:line: content".
 */
export function assembleRetrievalText(results: SearchResult[]): string {
	if (results.length === 0) return "";
	return results.map((r) => `${r.filePath}:${r.line}: ${r.content}`).join("\n");
}
