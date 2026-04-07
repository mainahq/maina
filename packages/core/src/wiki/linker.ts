/**
 * Wiki Linker — generates forward links and backlinks between wiki articles.
 *
 * Traverses the knowledge graph edges and maps them to wiki article paths
 * to produce bidirectional link maps used for wikilink injection.
 */

import type { KnowledgeGraph } from "./graph";
import type { WikiLink } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────

export interface LinkResult {
	forwardLinks: Map<string, WikiLink[]>;
	backlinks: Map<string, WikiLink[]>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function addToLinkMap(
	map: Map<string, WikiLink[]>,
	key: string,
	link: WikiLink,
): void {
	const list = map.get(key) ?? [];
	list.push(link);
	map.set(key, list);
}

/**
 * Find the article path for a given node ID.
 * Checks direct mapping first, then checks if the node belongs to a community.
 */
function resolveArticlePath(
	nodeId: string,
	articleMap: Map<string, string>,
	graph: KnowledgeGraph,
): string | null {
	// Direct match
	const direct = articleMap.get(nodeId);
	if (direct) return direct;

	// Check if the node is part of a community that has an article
	for (const [key, path] of articleMap) {
		if (key.startsWith("community:")) {
			// This is a module article — check if the node is in this community's adjacency
			const node = graph.nodes.get(nodeId);
			if (node?.type === "module") {
				const moduleName = node.label;
				if (path.includes(moduleName)) {
					return path;
				}
			}
		}
	}

	return null;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Generate forward links and backlinks between wiki articles based on graph edges.
 *
 * For each edge in the knowledge graph, if both source and target map to
 * wiki articles, create a forward link from source article to target article
 * and a backlink from target article to source article.
 */
export function generateLinks(
	graph: KnowledgeGraph,
	articleMap: Map<string, string>,
): LinkResult {
	const forwardLinks = new Map<string, WikiLink[]>();
	const backlinks = new Map<string, WikiLink[]>();

	for (const edge of graph.edges) {
		const sourcePath = resolveArticlePath(edge.source, articleMap, graph);
		const targetPath = resolveArticlePath(edge.target, articleMap, graph);

		if (!sourcePath || !targetPath) continue;
		if (sourcePath === targetPath) continue;

		// Forward link: source -> target
		addToLinkMap(forwardLinks, sourcePath, {
			target: targetPath,
			type: edge.type,
			weight: edge.weight,
		});

		// Backlink: target -> source
		addToLinkMap(backlinks, targetPath, {
			target: sourcePath,
			type: edge.type,
			weight: edge.weight,
		});
	}

	// Deduplicate links (same target + type = single link with max weight)
	const dedup = (map: Map<string, WikiLink[]>): void => {
		for (const [key, links] of map) {
			const seen = new Map<string, WikiLink>();
			for (const link of links) {
				const dedupKey = `${link.target}:${link.type}`;
				const existing = seen.get(dedupKey);
				if (!existing || link.weight > existing.weight) {
					seen.set(dedupKey, link);
				}
			}
			map.set(key, [...seen.values()]);
		}
	};

	dedup(forwardLinks);
	dedup(backlinks);

	return { forwardLinks, backlinks };
}
