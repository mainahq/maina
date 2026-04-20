/**
 * Self-contained wiki/graph.html — #200.
 *
 * Emits a single HTML file with no network requests at view time. We compute
 * node positions server-side with a tiny seeded force simulation, bake the
 * positions into an inline SVG, and ship vanilla JS only for the interactions
 * (search, type filter, click-to-open). Deterministic for the same input.
 */

import type { GraphEdge, GraphNode, KnowledgeGraph } from "./graph";
import type { WikiArticle } from "./types";

// ─── Options + types ───────────────────────────────────────────────────

export interface RenderGraphHtmlOptions {
	/** RNG seed for the layout. Defaults to 42. */
	seed?: number;
	/** Force simulation iterations. Defaults to 200 — enough for <500 nodes. */
	iterations?: number;
	/** Canvas dimensions (pixels). */
	width?: number;
	height?: number;
}

interface Point {
	x: number;
	y: number;
}

// ─── Seeded PRNG (mulberry32) ──────────────────────────────────────────

function makeRng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ─── Layout ────────────────────────────────────────────────────────────

/**
 * Deterministic force-directed layout.
 * O(N² + E) per iteration — plenty fast for <500 nodes.
 */
function layout(
	graph: KnowledgeGraph,
	opts: Required<RenderGraphHtmlOptions>,
): Map<string, Point> {
	const rng = makeRng(opts.seed);
	const nodes = [...graph.nodes.values()].sort((a, b) =>
		a.id.localeCompare(b.id),
	);
	const positions = new Map<string, Point>();
	const velocities = new Map<string, Point>();

	// Initialize positions inside a square centered at the middle of the canvas.
	const cx = opts.width / 2;
	const cy = opts.height / 2;
	const radius = Math.min(opts.width, opts.height) / 3;
	for (const n of nodes) {
		positions.set(n.id, {
			x: cx + (rng() - 0.5) * 2 * radius,
			y: cy + (rng() - 0.5) * 2 * radius,
		});
		velocities.set(n.id, { x: 0, y: 0 });
	}

	const area = opts.width * opts.height;
	const k = Math.sqrt(area / Math.max(nodes.length, 1));
	// Build adjacency for attractive forces along edges.
	const edgeList = graph.edges.map((e) => [e.source, e.target] as const);

	for (let iter = 0; iter < opts.iterations; iter++) {
		const temperature = 0.1 * opts.width * (1 - iter / opts.iterations);
		const disp = new Map<string, Point>();
		for (const n of nodes) disp.set(n.id, { x: 0, y: 0 });

		// Repulsive forces: O(N²)
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				if (!a || !b) continue;
				const pa = positions.get(a.id);
				const pb = positions.get(b.id);
				if (!pa || !pb) continue;
				let dx = pa.x - pb.x;
				let dy = pa.y - pb.y;
				const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
				if (dist > 5 * k) continue; // far-field skip
				const force = (k * k) / dist;
				dx = (dx / dist) * force;
				dy = (dy / dist) * force;
				const da = disp.get(a.id);
				const db = disp.get(b.id);
				if (da) {
					da.x += dx;
					da.y += dy;
				}
				if (db) {
					db.x -= dx;
					db.y -= dy;
				}
			}
		}

		// Attractive forces along edges.
		for (const [src, tgt] of edgeList) {
			const pa = positions.get(src);
			const pb = positions.get(tgt);
			if (!pa || !pb) continue;
			const dx = pa.x - pb.x;
			const dy = pa.y - pb.y;
			const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
			const force = (dist * dist) / k;
			const fx = (dx / dist) * force;
			const fy = (dy / dist) * force;
			const da = disp.get(src);
			const db = disp.get(tgt);
			if (da) {
				da.x -= fx;
				da.y -= fy;
			}
			if (db) {
				db.x += fx;
				db.y += fy;
			}
		}

		// Apply displacement, capped by temperature, and clamp to canvas.
		for (const n of nodes) {
			const d = disp.get(n.id);
			const p = positions.get(n.id);
			if (!d || !p) continue;
			const dd = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
			const lim = Math.min(dd, temperature);
			p.x += (d.x / dd) * lim;
			p.y += (d.y / dd) * lim;
			p.x = Math.max(20, Math.min(opts.width - 20, p.x));
			p.y = Math.max(20, Math.min(opts.height - 20, p.y));
		}
	}

	return positions;
}

// ─── Rendering helpers ─────────────────────────────────────────────────

function escapeAttr(s: string): string {
	return s.replace(/[&<>"']/g, (c) => {
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
				return "&#39;";
		}
	});
}

function colorForType(type: GraphNode["type"]): string {
	switch (type) {
		case "entity":
			return "#2563eb"; // blue
		case "module":
			return "#16a34a"; // green
		case "feature":
			return "#ea580c"; // orange
		case "decision":
			return "#9333ea"; // purple
		case "workflow":
			return "#dc2626"; // red
		default:
			return "#6b7280"; // grey
	}
}

/** Linearly scale PageRank to a node radius between 4 and 18 px. */
function radiusForPageRank(pageRank: number, min: number, max: number): number {
	if (max === min) return 8;
	const t = (pageRank - min) / (max - min);
	return 4 + t * 14;
}

function articlePathForNode(
	node: GraphNode,
	articles: WikiArticle[],
): string | null {
	// Match by label — same best-effort strategy the report uses.
	const match = articles.find((a) => a.title === node.label);
	return match ? match.path : null;
}

// ─── Public API ────────────────────────────────────────────────────────

export function renderGraphHtml(
	graph: KnowledgeGraph,
	articles: WikiArticle[],
	options: RenderGraphHtmlOptions = {},
): string {
	const opts: Required<RenderGraphHtmlOptions> = {
		seed: options.seed ?? 42,
		iterations: options.iterations ?? 200,
		width: options.width ?? 1400,
		height: options.height ?? 900,
	};

	const nodes = [...graph.nodes.values()].sort((a, b) =>
		a.id.localeCompare(b.id),
	);

	// Empty-state.
	if (nodes.length === 0) {
		return emptyStateHtml();
	}

	const positions = layout(graph, opts);
	const minPr = nodes.reduce((m, n) => Math.min(m, n.pageRank), Infinity);
	const maxPr = nodes.reduce((m, n) => Math.max(m, n.pageRank), -Infinity);

	const edgeSvg: string[] = [];
	for (const e of graph.edges) {
		const p1 = positions.get(e.source);
		const p2 = positions.get(e.target);
		if (!p1 || !p2) continue;
		edgeSvg.push(
			`<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" class="edge" />`,
		);
	}

	const nodeSvg: string[] = [];
	const nodeIndex: {
		id: string;
		label: string;
		type: string;
		path: string | null;
	}[] = [];
	for (const n of nodes) {
		const p = positions.get(n.id);
		if (!p) continue;
		const r = radiusForPageRank(n.pageRank, minPr, maxPr);
		const path = articlePathForNode(n, articles);
		nodeIndex.push({ id: n.id, label: n.label, type: n.type, path });
		nodeSvg.push(
			`<g class="node" data-id="${escapeAttr(n.id)}" data-type="${n.type}" data-label="${escapeAttr(n.label.toLowerCase())}"${path ? ` data-path="${escapeAttr(path)}"` : ""}>`,
		);
		nodeSvg.push(
			`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${colorForType(n.type)}" />`,
		);
		nodeSvg.push(
			`<text x="${(p.x + r + 2).toFixed(1)}" y="${(p.y + 3).toFixed(1)}" class="label">${escapeAttr(n.label)}</text>`,
		);
		nodeSvg.push(`</g>`);
	}

	return pageHtml({
		width: opts.width,
		height: opts.height,
		edgeSvg: edgeSvg.join(""),
		nodeSvg: nodeSvg.join(""),
		summary: `${nodes.length} nodes · ${graph.edges.length} edges`,
	});
}

// ─── HTML templates ────────────────────────────────────────────────────

function pageHtml(ctx: {
	width: number;
	height: number;
	edgeSvg: string;
	nodeSvg: string;
	summary: string;
}): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>maina wiki · graph</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b0b0b; color: #eee; }
    .panel { background: #1a1a1a !important; border-color: #333 !important; }
    .edge { stroke: #333 !important; }
    .label { fill: #ddd !important; }
  }
  header { padding: 10px 14px; border-bottom: 1px solid #ddd; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0; }
  header .summary { color: #666; font-size: 12px; }
  .panel { display: inline-flex; gap: 8px; align-items: center; padding: 6px 10px; border: 1px solid #ddd; border-radius: 8px; background: #fff; }
  input[type="search"] { border: 0; outline: 0; font: inherit; background: transparent; color: inherit; width: 180px; }
  label { font-size: 12px; user-select: none; }
  svg { display: block; }
  .edge { stroke: #d4d4d4; stroke-width: 1; }
  .label { font-size: 11px; fill: #333; pointer-events: none; }
  .node { cursor: pointer; }
  .node:hover circle { stroke: #111; stroke-width: 2; }
  .node.dim { opacity: 0.15; }
  .legend { display: inline-flex; gap: 10px; align-items: center; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
</style>
</head>
<body>
<header>
  <h1>maina wiki · graph</h1>
  <span class="summary">${ctx.summary}</span>
  <div class="panel">
    <input id="q" type="search" placeholder="Search nodes…" />
  </div>
  <div class="panel legend">
    ${(["entity", "module", "feature", "decision", "workflow"] as const)
			.map(
				(t) =>
					`<label><input type="checkbox" data-filter="${t}" checked /><span class="dot" style="background:${colorForType(t)}"></span>${t}</label>`,
			)
			.join("")}
  </div>
</header>
<svg viewBox="0 0 ${ctx.width} ${ctx.height}" width="100%" height="calc(100vh - 60px)" preserveAspectRatio="xMidYMid meet">
  <g id="edges">${ctx.edgeSvg}</g>
  <g id="nodes">${ctx.nodeSvg}</g>
</svg>
<script>
(function() {
  const svg = document.querySelector('svg');
  const nodes = [...svg.querySelectorAll('.node')];
  const q = document.getElementById('q');
  const filters = [...document.querySelectorAll('[data-filter]')];

  function applyFilters() {
    const needle = (q.value || '').trim().toLowerCase();
    const enabled = new Set(
      filters.filter((f) => f.checked).map((f) => f.dataset.filter),
    );
    for (const n of nodes) {
      const typeOk = enabled.has(n.dataset.type);
      const labelOk = !needle || (n.dataset.label || '').includes(needle);
      n.classList.toggle('dim', !(typeOk && labelOk));
    }
  }

  q.addEventListener('input', applyFilters);
  filters.forEach((f) => f.addEventListener('change', applyFilters));
  nodes.forEach((n) => {
    n.addEventListener('click', () => {
      const p = n.dataset.path;
      if (p) window.location.href = p;
    });
  });
})();
</script>
</body>
</html>`;
}

function emptyStateHtml(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>maina wiki · graph (empty)</title>
<style>
  body { margin: 0; display: flex; min-height: 100vh; align-items: center; justify-content: center; font: 14px system-ui; background: #fafafa; color: #444; }
  main { text-align: center; max-width: 480px; padding: 32px; }
  h1 { font-size: 20px; }
  p { line-height: 1.5; }
</style>
</head>
<body>
<main>
  <h1>No graph yet</h1>
  <p>Run <code>maina wiki compile</code> to build the knowledge graph. This page will show a force-directed view of its nodes, edges, and communities once compilation produces at least one node.</p>
</main>
</body>
</html>`;
}
