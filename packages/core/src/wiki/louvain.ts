/**
 * Louvain Community Detection — identifies module boundaries in the knowledge graph.
 *
 * Implements the Louvain method for community detection:
 * 1. Start each node in its own community
 * 2. For each node, try moving to a neighbor's community if it improves modularity
 * 3. Repeat until no improvement (convergence)
 * 4. Return communities map + modularity score
 *
 * Deterministic: nodes are sorted before iteration. Handles disconnected components.
 * Scales to 1000+ nodes in < 1 second.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export interface LouvainNode {
	id: string;
	community: number;
}

export interface LouvainResult {
	communities: Map<number, string[]>;
	modularity: number;
}

// ─── Modularity Helpers ─────────────────────────────────────────────────

/**
 * Total number of edges (each undirected edge counted once).
 */
function totalEdges(adjacency: Map<string, Set<string>>): number {
	let count = 0;
	for (const neighbors of adjacency.values()) {
		count += neighbors.size;
	}
	// Each edge is counted twice in an undirected adjacency list
	return count / 2;
}

/**
 * Compute modularity for the current community assignment.
 * Q = (1/2m) * sum_ij [ A_ij - (k_i * k_j) / 2m ] * delta(c_i, c_j)
 */
function computeModularity(
	adjacency: Map<string, Set<string>>,
	communityOf: Map<string, number>,
	m: number,
): number {
	if (m === 0) return 0;

	let q = 0;
	const twoM = 2 * m;

	for (const [nodeI, neighbors] of adjacency) {
		const ci = communityOf.get(nodeI) ?? -1;
		const ki = neighbors.size;

		for (const nodeJ of neighbors) {
			const cj = communityOf.get(nodeJ) ?? -1;
			if (ci !== cj) continue;

			const kj = adjacency.get(nodeJ)?.size ?? 0;
			// A_ij = 1 since nodeJ is in neighbors of nodeI
			q += 1 - (ki * kj) / twoM;
		}
	}

	return q / twoM;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Detect communities using the Louvain method.
 * Input: adjacency list (node -> Set<neighbor>).
 * Output: communities map (community ID -> node IDs) + modularity score.
 *
 * Optimized with pre-computed degree map and running community degree totals
 * to avoid O(N) scan per modularity gain computation.
 */
export function detectCommunities(
	adjacency: Map<string, Set<string>>,
): LouvainResult {
	const nodes = [...adjacency.keys()].sort();

	if (nodes.length === 0) {
		return { communities: new Map(), modularity: 0 };
	}

	const m = totalEdges(adjacency);

	// Pre-compute degrees
	const deg = new Map<string, number>();
	for (const [node, neighbors] of adjacency) {
		deg.set(node, neighbors.size);
	}

	// Phase 1: Assign each node to its own community
	const communityOf = new Map<string, number>();
	// Track sum of degrees per community for O(1) lookup
	const commSumTot = new Map<number, number>();

	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i] ?? "";
		communityOf.set(node, i);
		commSumTot.set(i, deg.get(node) ?? 0);
	}

	// Phase 2: Iteratively move nodes to improve modularity
	const maxIterations = 100;
	for (let iter = 0; iter < maxIterations; iter++) {
		let improved = false;

		for (const nodeId of nodes) {
			const currentComm = communityOf.get(nodeId) ?? 0;
			const neighbors = adjacency.get(nodeId) ?? new Set<string>();
			const ki = deg.get(nodeId) ?? 0;

			if (ki === 0) continue;

			// Find neighbor communities and count edges into each
			const neighborCommEdges = new Map<number, number>();
			for (const neighbor of neighbors) {
				const nc = communityOf.get(neighbor) ?? -1;
				neighborCommEdges.set(nc, (neighborCommEdges.get(nc) ?? 0) + 1);
			}

			// Current community edges (k_in for current)
			const kInCurrent = neighborCommEdges.get(currentComm) ?? 0;
			// sumTot for current community minus this node's own degree
			const sumTotCurrent = (commSumTot.get(currentComm) ?? 0) - ki;

			let bestGain = 0;
			let bestComm = currentComm;

			// Evaluate moving to each neighbor community
			const candidateComms = [...neighborCommEdges.keys()]
				.filter((c) => c !== currentComm)
				.sort((a, b) => a - b);

			for (const candidateComm of candidateComms) {
				const kInCandidate = neighborCommEdges.get(candidateComm) ?? 0;
				const sumTotCandidate = commSumTot.get(candidateComm) ?? 0;

				// delta_Q = [k_in_new / m - ki * sumTot_new / (2m^2)]
				//         - [k_in_old / m - ki * sumTot_old / (2m^2)]
				const gainNew = kInCandidate / m - (ki * sumTotCandidate) / (2 * m * m);
				const lossCurrent = kInCurrent / m - (ki * sumTotCurrent) / (2 * m * m);
				const netGain = gainNew - lossCurrent;

				if (netGain > bestGain) {
					bestGain = netGain;
					bestComm = candidateComm;
				}
			}

			if (bestComm !== currentComm) {
				// Update community assignment and running totals
				commSumTot.set(currentComm, (commSumTot.get(currentComm) ?? 0) - ki);
				commSumTot.set(bestComm, (commSumTot.get(bestComm) ?? 0) + ki);
				communityOf.set(nodeId, bestComm);
				improved = true;
			}
		}

		if (!improved) break;
	}

	// Phase 3: Build communities map, renumbering to be contiguous
	const rawCommunities = new Map<number, string[]>();
	for (const [node, comm] of communityOf) {
		const list = rawCommunities.get(comm) ?? [];
		list.push(node);
		rawCommunities.set(comm, list);
	}

	// Renumber communities to 0..N-1
	const communities = new Map<number, string[]>();
	let idx = 0;
	for (const [, members] of [...rawCommunities.entries()].sort(
		([a], [b]) => a - b,
	)) {
		communities.set(idx, members.sort());
		idx++;
	}

	const modularity = computeModularity(adjacency, communityOf, m);

	return { communities, modularity };
}
