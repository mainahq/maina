/**
 * DeepWiki-compatible MCP tools.
 *
 * Exposes 3 tools matching DeepWiki's surface for instant interop
 * with any client that already speaks DeepWiki:
 * - ask_question(repo, question)
 * - read_wiki_structure(repo)
 * - read_wiki_contents(repo, page)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerDeepWikiTools(server: McpServer): void {
	server.tool(
		"ask_question",
		"Ask a question about the codebase. Returns an answer synthesized from the wiki knowledge base.",
		{ repo: z.string().optional(), question: z.string() },
		async ({ question }) => {
			try {
				const { queryWiki } = await import("@mainahq/core");
				const mainaDir = join(process.cwd(), ".maina");
				const wikiDir = join(mainaDir, "wiki");

				const result = await queryWiki({
					question,
					wikiDir,
				});

				if (!result.ok) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									data: null,
									error: result.error,
									meta: { question },
								}),
							},
						],
						isError: true,
					};
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								data: {
									answer: result.value.answer,
									sources: result.value.sources,
								},
								error: null,
								meta: { question },
							}),
						},
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								data: null,
								error: e instanceof Error ? e.message : String(e),
								meta: { question },
							}),
						},
					],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"read_wiki_structure",
		"Get the wiki structure — list of all articles with paths and types.",
		{ repo: z.string().optional() },
		async () => {
			try {
				const wikiDir = join(process.cwd(), ".maina", "wiki");
				const indexPath = join(wikiDir, "index.md");

				if (!existsSync(indexPath)) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									data: { articles: [], total: 0 },
									error: null,
									meta: {
										hint: "No wiki found. Run `maina wiki init` to compile.",
									},
								}),
							},
						],
					};
				}

				// Scan wiki directories for articles
				const articles: Array<{
					path: string;
					type: string;
					title: string;
				}> = [];
				const categories = [
					"modules",
					"entities",
					"features",
					"decisions",
					"architecture",
				];

				for (const category of categories) {
					const dir = join(wikiDir, category);
					if (!existsSync(dir)) continue;
					try {
						const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
						for (const file of files) {
							const title = file.replace(/\.md$/, "").replace(/-/g, " ");
							articles.push({
								path: `${category}/${file}`,
								type: category.replace(/s$/, ""),
								title,
							});
						}
					} catch {
						// Skip unreadable directories
					}
				}

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								data: { articles, total: articles.length },
								error: null,
								meta: {},
							}),
						},
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								data: null,
								error: e instanceof Error ? e.message : String(e),
								meta: {},
							}),
						},
					],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"read_wiki_contents",
		"Read the contents of a specific wiki article.",
		{ repo: z.string().optional(), page: z.string() },
		async ({ page }) => {
			try {
				const wikiDir = join(process.cwd(), ".maina", "wiki");
				const filePath = join(wikiDir, page);

				if (!existsSync(filePath)) {
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									data: null,
									error: `Article not found: ${page}`,
									meta: { page },
								}),
							},
						],
						isError: true,
					};
				}

				const content = readFileSync(filePath, "utf-8");
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								data: { page, content },
								error: null,
								meta: {},
							}),
						},
					],
				};
			} catch (e) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								data: null,
								error: e instanceof Error ? e.message : String(e),
								meta: { page },
							}),
						},
					],
					isError: true,
				};
			}
		},
	);
}
