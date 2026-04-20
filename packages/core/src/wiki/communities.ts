/**
 * Community detection for the knowledge graph — #199.
 *
 * Two algorithms, one public entry point:
 *
 *   - **louvain** — the classic algorithm implemented in `./louvain.ts`.
 *     Fast, usually high modularity, but can produce disconnected communities
 *     (Traag et al. 2019 showed Louvain sometimes splits a cluster across
 *     two communities connected only through the graph's body).
 *
 *   - **leiden-connected** — starts from Louvain's partition and applies a
 *     refinement pass that guarantees every returned community is
 *     **internally connected**. Disconnected pieces within a Louvain
 *     community are split into their own communities. This always produces
 *     modularity ≥ Louvain because the cross-piece pairs that used to
 *     contribute negatively (A_ij = 0 but k_i·k_j/2m > 0) are removed from
 *     the same-community sum.
 *
 * The label is `"leiden-connected"` rather than `"leiden"` on purpose — the
 * full Traag/Waltman/van Eck algorithm also does a per-community random-order
 * move pass and multi-level aggregation. We only do the connectedness-only
 * refinement, which is enough for the two invariants the wiki use-case cares
 * about:
 *   1. No disconnected communities.
 *   2. Modularity ≥ Louvain on the same graph.
 *
 * Upgrade to the full algorithm in a follow-up if module articles still look
 * weird after real-repo measurements.
 */

import { detectCommunities as detectLouvain } from "./louvain";

// ─── Types ──────────────────────────────────────────────────────────────

export type CommunityAlgorithm = "leiden-connected" | "louvain";

export interface CommunitiesResult {
	/** community id → node ids (sorted, stable). */
	communities: Map<number, string[]>;
	/** Computed modularity under the returned partition. */
	modularity: number;
	/** Which algorithm produced this partition. */
	algorithm: CommunityAlgorithm;
}

export interface DetectOptions {
	/** Defaults to `"leiden-connected"`. */
	algorithm?: CommunityAlgorithm;
	/**
	 * Deterministic seed hook. The current implementation is fully
	 * deterministic (no randomized moves), so this value is accepted and
	 * forwarded for API stability only. A full Leiden rewrite with
	 * randomized refinement will consume this seed.
	 */
	seed?: number;
}

// ─── Modularity (same formulation Louvain uses) ─────────────────────────

function totalEdges(adjacency: Map<string, Set<string>>): number {
	let count = 0;
	for (const neighbors of adjacency.values()) count += neighbors.size;
	return count / 2;
}

function computeModularity(
	adjacency: Map<string, Set<string>>,
	communityOf: Map<string, number>,
	m: number,
): number {
	if (m === 0) return 0;
	const twoM = 2 * m;
	let q = 0;
	for (const [nodeI, neighbors] of adjacency) {
		const ci = communityOf.get(nodeI) ?? -1;
		const ki = neighbors.size;
		for (const nodeJ of neighbors) {
			const cj = communityOf.get(nodeJ) ?? -1;
			if (ci !== cj) continue;
			const kj = adjacency.get(nodeJ)?.size ?? 0;
			q += 1 - (ki * kj) / twoM;
		}
	}
	return q / twoM;
}

// ─── Connectedness refinement ───────────────────────────────────────────

/**
 * Given a community's members and the full graph, return connected-component
 * subsets. BFS per unvisited node; O(E) total per community.
 */
function splitIntoConnectedComponents(
	members: string[],
	adjacency: Map<string, Set<string>>,
): string[][] {
	const memberSet = new Set(members);
	const visited = new Set<string>();
	const components: string[][] = [];
	// Sort for determinism — BFS seed order drives component ordering.
	for (const start of [...members].sort()) {
		if (visited.has(start)) continue;
		const queue = [start];
		const component: string[] = [];
		visited.add(start);
		while (queue.length > 0) {
			const node = queue.shift();
			if (node === undefined) break;
			component.push(node);
			const neighbors = adjacency.get(node) ?? new Set();
			for (const n of [...neighbors].sort()) {
				// Only walk within this community's members — the point of the
				// split is that cross-community edges don't count as connections
				// here.
				if (memberSet.has(n) && !visited.has(n)) {
					visited.add(n);
					queue.push(n);
				}
			}
		}
		components.push(component.sort());
	}
	return components;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Detect communities. Defaults to `leiden-connected` — same shape as the old
 * `detectCommunities` from `./louvain.ts` plus an `algorithm` field.
 */
export function detectCommunities(
	adjacency: Map<string, Set<string>>,
	options: DetectOptions = {},
): CommunitiesResult {
	const algorithm = options.algorithm ?? "leiden-connected";
	// Seed is plumbed for future use; the current deterministic implementation
	// ignores it. Keeping the parameter in the signature so the contract is
	// stable when the full Leiden refinement pass lands.
	void options.seed;

	const base = detectLouvain(adjacency);

	if (algorithm === "louvain") {
		return {
			communities: base.communities,
			modularity: base.modularity,
			algorithm: "louvain",
		};
	}

	// leiden-connected: refine by splitting any disconnected community into
	// its connected components.
	const refined = new Map<number, string[]>();
	let nextId = 0;
	// Walk original communities in id order — keeps output deterministic.
	for (const [, members] of [...base.communities.entries()].sort(
		([a], [b]) => a - b,
	)) {
		if (members.length === 0) continue;
		const components = splitIntoConnectedComponents(members, adjacency);
		for (const component of components) {
			refined.set(nextId, component);
			nextId += 1;
		}
	}

	// Recompute modularity under the refined partition.
	const communityOf = new Map<string, number>();
	for (const [id, members] of refined) {
		for (const node of members) communityOf.set(node, id);
	}
	const modularity = computeModularity(
		adjacency,
		communityOf,
		totalEdges(adjacency),
	);

	return { communities: refined, modularity, algorithm: "leiden-connected" };
}
