import { describe, expect, it } from "bun:test";
import { detectCommunities } from "../communities";
import { detectCommunities as detectLouvain } from "../louvain";

function adjOf(
	edges: [string, string][],
	isolated: string[] = [],
): Map<string, Set<string>> {
	const adj = new Map<string, Set<string>>();
	for (const node of isolated) adj.set(node, new Set());
	for (const [a, b] of edges) {
		if (!adj.has(a)) adj.set(a, new Set());
		if (!adj.has(b)) adj.set(b, new Set());
		adj.get(a)?.add(b);
		adj.get(b)?.add(a);
	}
	return adj;
}

describe("communities.detectCommunities", () => {
	describe("defaults", () => {
		it("defaults to leiden-connected", () => {
			const adj = adjOf([["a", "b"]]);
			const r = detectCommunities(adj);
			expect(r.algorithm).toBe("leiden-connected");
		});

		it("accepts algorithm: 'louvain'", () => {
			const adj = adjOf([["a", "b"]]);
			const r = detectCommunities(adj, { algorithm: "louvain" });
			expect(r.algorithm).toBe("louvain");
		});
	});

	describe("empty + trivial graphs", () => {
		it("empty graph", () => {
			const r = detectCommunities(new Map());
			expect(r.communities.size).toBe(0);
			expect(r.modularity).toBe(0);
		});

		it("single node", () => {
			const r = detectCommunities(adjOf([], ["x"]));
			expect(r.communities.size).toBe(1);
			expect([...r.communities.values()].flat()).toContain("x");
		});

		it("barbell graph produces two communities", () => {
			// A-B-C clique, D-E-F clique, C-D bridge.
			const adj = adjOf([
				["A", "B"],
				["A", "C"],
				["B", "C"],
				["C", "D"],
				["D", "E"],
				["D", "F"],
				["E", "F"],
			]);
			const r = detectCommunities(adj);
			expect(r.communities.size).toBe(2);
		});
	});

	describe("connectedness invariant (the reason Leiden exists)", () => {
		it("splits a disconnected community into connected components", () => {
			// Force Louvain into a misleading spot: give the algorithm a
			// community where some members are only connected to each other
			// via a node that ends up in a different community. We simulate
			// this by building a graph with two cliques joined by a single
			// weak node — Louvain sometimes lumps the weak node with one
			// clique, leaving the other clique's members disconnected from
			// each other inside their own community.
			//
			// To keep the test deterministic regardless of Louvain's exact
			// partition, we assert the invariant directly.
			const adj = adjOf([
				["a", "b"],
				["b", "c"],
				["a", "c"], // left clique
				["d", "e"],
				["e", "f"],
				["d", "f"], // right clique
				["c", "x"],
				["x", "d"], // x is the bridge
				["g", "h"], // isolated second graph
			]);

			const leiden = detectCommunities(adj, { algorithm: "leiden-connected" });

			for (const members of leiden.communities.values()) {
				if (members.length <= 1) continue;
				// Every member must be reachable from members[0] within this
				// community's induced subgraph.
				const memberSet = new Set(members);
				const seen = new Set<string>();
				const queue = [members[0] ?? ""];
				seen.add(queue[0] ?? "");
				while (queue.length) {
					const n = queue.shift();
					if (n === undefined) break;
					for (const nb of adj.get(n) ?? []) {
						if (memberSet.has(nb) && !seen.has(nb)) {
							seen.add(nb);
							queue.push(nb);
						}
					}
				}
				expect(seen.size).toBe(members.length);
			}
		});
	});

	describe("modularity — Leiden ≥ Louvain", () => {
		it("on a graph with a disconnected Louvain community, Leiden does at least as well", () => {
			// Two triangles bridged by two separate paths — designed so
			// Louvain is tempted to put one triangle's nodes across two
			// communities.
			const adj = adjOf([
				["a", "b"],
				["b", "c"],
				["a", "c"],
				["d", "e"],
				["e", "f"],
				["d", "f"],
				["c", "g"],
				["g", "d"],
				["a", "h"],
				["h", "f"],
			]);

			const louvain = detectLouvain(adj);
			const leiden = detectCommunities(adj, { algorithm: "leiden-connected" });

			expect(leiden.modularity).toBeGreaterThanOrEqual(louvain.modularity);
		});
	});

	describe("determinism", () => {
		it("returns identical output across repeat runs", () => {
			const adj = adjOf([
				["a", "b"],
				["b", "c"],
				["a", "c"],
				["d", "e"],
				["e", "f"],
				["d", "f"],
				["c", "d"],
			]);
			const r1 = detectCommunities(adj);
			const r2 = detectCommunities(adj);
			expect(r1.modularity).toBe(r2.modularity);
			expect([...r1.communities.entries()]).toEqual([
				...r2.communities.entries(),
			]);
		});
	});

	describe("repo-scale: Leiden modularity ≥ Louvain", () => {
		it("on a many-clique graph with bridge nodes that Louvain is known to mis-split", () => {
			// Simulate a real monorepo: 10 "modules" of 6 tightly-connected
			// entities, joined by 5 bridge nodes that each span two modules.
			// This is the shape the Traag 2019 paper demonstrates Louvain
			// fails on — some modules get split across communities, leaving
			// disconnected pieces. Leiden (our connectedness variant or full)
			// must produce modularity ≥ Louvain here.
			const edges: [string, string][] = [];
			const MODULES = 10;
			const SIZE = 6;
			for (let m = 0; m < MODULES; m++) {
				for (let i = 0; i < SIZE; i++) {
					for (let j = i + 1; j < SIZE; j++) {
						edges.push([`m${m}_n${i}`, `m${m}_n${j}`]);
					}
				}
			}
			for (let b = 0; b < 5; b++) {
				const left = `m${b}_n0`;
				const right = `m${b + 5}_n0`;
				const bridge = `bridge_${b}`;
				edges.push([left, bridge]);
				edges.push([bridge, right]);
			}
			const adj = adjOf(edges);

			const louvain = detectLouvain(adj);
			const leiden = detectCommunities(adj, { algorithm: "leiden-connected" });

			expect(leiden.modularity).toBeGreaterThanOrEqual(louvain.modularity);
			// Leiden must never return a disconnected community on this input.
			for (const members of leiden.communities.values()) {
				if (members.length <= 1) continue;
				const memberSet = new Set(members);
				const seen = new Set<string>([members[0] ?? ""]);
				const queue = [members[0] ?? ""];
				while (queue.length) {
					const n = queue.shift();
					if (n === undefined) break;
					for (const nb of adj.get(n) ?? []) {
						if (memberSet.has(nb) && !seen.has(nb)) {
							seen.add(nb);
							queue.push(nb);
						}
					}
				}
				expect(seen.size).toBe(members.length);
			}
		});
	});

	describe("seed option is accepted for future API stability", () => {
		it("passing a seed does not change current (deterministic) output", () => {
			const adj = adjOf([
				["a", "b"],
				["b", "c"],
			]);
			const r1 = detectCommunities(adj);
			const r2 = detectCommunities(adj, { seed: 12345 });
			expect(r1.modularity).toBe(r2.modularity);
			expect([...r1.communities.entries()]).toEqual([
				...r2.communities.entries(),
			]);
		});
	});

	describe("fallback to louvain still works", () => {
		it("louvain path matches the old direct call", () => {
			const adj = adjOf([
				["a", "b"],
				["b", "c"],
				["c", "d"],
				["d", "a"],
			]);
			const direct = detectLouvain(adj);
			const viaNew = detectCommunities(adj, { algorithm: "louvain" });
			expect(viaNew.modularity).toBe(direct.modularity);
			expect([...viaNew.communities.entries()]).toEqual([
				...direct.communities.entries(),
			]);
		});
	});
});
