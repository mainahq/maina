/**
 * Knowledge-graph exporters — #202.
 *
 * Pure function over `KnowledgeGraph` + `WikiArticle[]`. No filesystem access;
 * the CLI subcommand writes bytes. Cloud reuses the same serializer via HTTP.
 *
 * Supported formats:
 *   - `cypher`   — Neo4j 5.x-compatible `CREATE` statements wrapped in a
 *                   single transaction.
 *   - `graphml`  — W3C GraphML XML; opens in Gephi and yEd.
 *   - `obsidian` — directory of markdown + `.obsidian/workspace.json`;
 *                   drag-into-Obsidian compatible.
 */

import type { GraphEdge, GraphNode, KnowledgeGraph } from "./graph";
import type { WikiArticle } from "./types";

// ─── Types ──────────────────────────────────────────────────────────────

export type ExportFormat = "cypher" | "graphml" | "obsidian";

/** Single-file formats return string; Obsidian returns a path→contents map. */
export type ExportResult =
	| { ok: true; format: "cypher" | "graphml"; contents: string }
	| { ok: true; format: "obsidian"; files: Record<string, string> }
	| { ok: false; error: string };

// ─── Cypher ─────────────────────────────────────────────────────────────

function cypherLabel(type: GraphNode["type"]): string {
	// Cypher labels are identifiers — start uppercase, no spaces.
	switch (type) {
		case "entity":
			return "Entity";
		case "module":
			return "Module";
		case "feature":
			return "Feature";
		case "decision":
			return "Decision";
		case "workflow":
			return "Workflow";
		default:
			return "Node";
	}
}

function cypherString(value: string): string {
	return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function cypherRelType(edgeType: string): string {
	// Cypher rel types are uppercase snake-ish identifiers.
	return edgeType.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

export function exportCypher(
	graph: KnowledgeGraph,
	_articles: WikiArticle[],
): string {
	const lines: string[] = [];
	lines.push("// Maina knowledge graph — Cypher export");
	lines.push("// Load into Neo4j 5.x via `cat export.cypher | cypher-shell`");
	lines.push("BEGIN");

	const nodes = [...graph.nodes.values()].sort((a, b) =>
		a.id.localeCompare(b.id),
	);
	for (const node of nodes) {
		const label = cypherLabel(node.type);
		const props = [
			`id: ${cypherString(node.id)}`,
			`label: ${cypherString(node.label)}`,
			`type: ${cypherString(node.type)}`,
			`pageRank: ${node.pageRank}`,
		];
		if (node.file) props.push(`file: ${cypherString(node.file)}`);
		lines.push(`CREATE (:${label} {${props.join(", ")}});`);
	}

	const edges = [...graph.edges].sort((a, b) => {
		if (a.source !== b.source) return a.source.localeCompare(b.source);
		if (a.target !== b.target) return a.target.localeCompare(b.target);
		return a.type.localeCompare(b.type);
	});
	for (const edge of edges) {
		const rel = cypherRelType(edge.type);
		lines.push(
			`MATCH (a {id: ${cypherString(edge.source)}}), (b {id: ${cypherString(
				edge.target,
			)}}) CREATE (a)-[:${rel} {weight: ${edge.weight}}]->(b);`,
		);
	}

	lines.push("COMMIT");
	return `${lines.join("\n")}\n`;
}

// ─── GraphML ────────────────────────────────────────────────────────────

function xmlEscape(value: string): string {
	return value.replace(/[&<>"']/g, (c) => {
		switch (c) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&apos;";
		}
	});
}

export function exportGraphMl(
	graph: KnowledgeGraph,
	_articles: WikiArticle[],
): string {
	const lines: string[] = [];
	lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
	lines.push(
		`<graphml xmlns="http://graphml.graphdrawing.org/xmlns" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">`,
	);
	lines.push(`<key id="d0" for="node" attr.name="label" attr.type="string"/>`);
	lines.push(`<key id="d1" for="node" attr.name="type" attr.type="string"/>`);
	lines.push(
		`<key id="d2" for="node" attr.name="pageRank" attr.type="double"/>`,
	);
	lines.push(`<key id="d3" for="node" attr.name="file" attr.type="string"/>`);
	lines.push(`<key id="e0" for="edge" attr.name="type" attr.type="string"/>`);
	lines.push(`<key id="e1" for="edge" attr.name="weight" attr.type="double"/>`);
	lines.push(`<graph id="maina" edgedefault="directed">`);

	const nodes = [...graph.nodes.values()].sort((a, b) =>
		a.id.localeCompare(b.id),
	);
	for (const node of nodes) {
		lines.push(`  <node id="${xmlEscape(node.id)}">`);
		lines.push(`    <data key="d0">${xmlEscape(node.label)}</data>`);
		lines.push(`    <data key="d1">${xmlEscape(node.type)}</data>`);
		lines.push(`    <data key="d2">${node.pageRank}</data>`);
		if (node.file) {
			lines.push(`    <data key="d3">${xmlEscape(node.file)}</data>`);
		}
		lines.push(`  </node>`);
	}

	const edges = [...graph.edges].sort((a, b) => {
		if (a.source !== b.source) return a.source.localeCompare(b.source);
		if (a.target !== b.target) return a.target.localeCompare(b.target);
		return a.type.localeCompare(b.type);
	});
	edges.forEach((edge, i) => {
		lines.push(
			`  <edge id="e${i}" source="${xmlEscape(edge.source)}" target="${xmlEscape(
				edge.target,
			)}">`,
		);
		lines.push(`    <data key="e0">${xmlEscape(edge.type)}</data>`);
		lines.push(`    <data key="e1">${edge.weight}</data>`);
		lines.push(`  </edge>`);
	});

	lines.push(`</graph>`);
	lines.push(`</graphml>`);
	return `${lines.join("\n")}\n`;
}

// ─── Obsidian ───────────────────────────────────────────────────────────

function safeFilename(input: string): string {
	return input.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Short stable suffix derived from the original id. Prevents filename
 * collisions when two distinct ids collapse to the same sanitised name
 * (e.g. `foo/bar` and `foo_bar` both sanitise to `foo_bar`).
 */
function idHashSuffix(id: string): string {
	let h = 0;
	for (let i = 0; i < id.length; i++) {
		h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(36).slice(0, 6);
}

function obsidianFilenameForNode(node: GraphNode): string {
	const safe = safeFilename(node.id);
	// Append a 6-char hash of the original id when sanitisation changed
	// anything — cheap, deterministic, collision-resistant enough for a
	// per-repo vault (2⁻²⁴ ≈ 6e-8 per-pair).
	const suffix = safe === node.id ? "" : `-${idHashSuffix(node.id)}`;
	return `${safeFilename(node.type)}/${safe}${suffix}.md`;
}

/**
 * Directory map: `path → file contents`. Caller writes each entry to disk.
 *
 * Layout:
 *   <type>/<id>.md      — one page per graph node
 *   index.md            — landing page listing all nodes by type
 *   .obsidian/workspace.json  — minimal Obsidian workspace
 */
export function exportObsidian(
	graph: KnowledgeGraph,
	articles: WikiArticle[],
): Record<string, string> {
	const files: Record<string, string> = {};
	const articleByLabel = new Map<string, WikiArticle>();
	for (const a of articles) articleByLabel.set(a.title, a);

	const nodes = [...graph.nodes.values()].sort((a, b) =>
		a.id.localeCompare(b.id),
	);

	// Precompute neighbor lists for backlinks.
	const outgoing = new Map<string, GraphEdge[]>();
	const incoming = new Map<string, GraphEdge[]>();
	for (const e of graph.edges) {
		(outgoing.get(e.source) ?? outgoing.set(e.source, []).get(e.source))?.push(
			e,
		);
		(incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target))?.push(
			e,
		);
	}

	// Per-node pages.
	for (const node of nodes) {
		const path = obsidianFilenameForNode(node);
		const lines: string[] = [];
		lines.push("---");
		lines.push(`id: ${JSON.stringify(node.id)}`);
		lines.push(`label: ${JSON.stringify(node.label)}`);
		lines.push(`type: ${node.type}`);
		lines.push(`pageRank: ${node.pageRank}`);
		if (node.file) lines.push(`file: ${JSON.stringify(node.file)}`);
		lines.push("---");
		lines.push("");
		lines.push(`# ${node.label}`);
		lines.push("");
		const article = articleByLabel.get(node.label);
		if (article?.content) {
			lines.push(article.content);
			lines.push("");
		}
		const outs = outgoing.get(node.id) ?? [];
		if (outs.length > 0) {
			lines.push("## Outgoing");
			for (const e of outs) {
				const tgt = graph.nodes.get(e.target);
				if (tgt) {
					lines.push(`- ${e.type} → [[${tgt.id}|${tgt.label}]]`);
				}
			}
			lines.push("");
		}
		const ins = incoming.get(node.id) ?? [];
		if (ins.length > 0) {
			lines.push("## Incoming");
			for (const e of ins) {
				const src = graph.nodes.get(e.source);
				if (src) {
					lines.push(`- ${e.type} ← [[${src.id}|${src.label}]]`);
				}
			}
			lines.push("");
		}
		files[path] = lines.join("\n");
	}

	// Index.
	const index: string[] = ["# maina graph", ""];
	const byType = new Map<string, GraphNode[]>();
	for (const n of nodes) {
		const list = byType.get(n.type) ?? [];
		list.push(n);
		byType.set(n.type, list);
	}
	for (const type of [...byType.keys()].sort()) {
		index.push(`## ${type}`);
		index.push("");
		for (const n of byType.get(type) ?? []) {
			index.push(`- [[${n.id}|${n.label}]]`);
		}
		index.push("");
	}
	files["index.md"] = index.join("\n");

	// Minimal Obsidian workspace.
	files[".obsidian/workspace.json"] = JSON.stringify(
		{
			main: {
				id: "maina-root",
				type: "split",
				children: [
					{
						id: "maina-leaf",
						type: "leaf",
						state: { type: "markdown", state: { file: "index.md" } },
					},
				],
				direction: "vertical",
			},
			active: "maina-leaf",
		},
		null,
		2,
	);

	return files;
}

// ─── Public dispatcher ──────────────────────────────────────────────────

export function exportGraph(
	graph: KnowledgeGraph,
	articles: WikiArticle[],
	format: ExportFormat,
): ExportResult {
	switch (format) {
		case "cypher":
			return {
				ok: true,
				format: "cypher",
				contents: exportCypher(graph, articles),
			};
		case "graphml":
			return {
				ok: true,
				format: "graphml",
				contents: exportGraphMl(graph, articles),
			};
		case "obsidian":
			return {
				ok: true,
				format: "obsidian",
				files: exportObsidian(graph, articles),
			};
		default:
			return { ok: false, error: `unknown format: ${format as string}` };
	}
}
