import { describe, expect, it } from "bun:test";
import { detectCommunities } from "../louvain";

describe("Louvain Community Detection", () => {
	describe("empty graph", () => {
		it("should return empty communities and zero modularity", () => {
			const adjacency = new Map<string, Set<string>>();
			const result = detectCommunities(adjacency);

			expect(result.communities.size).toBe(0);
			expect(result.modularity).toBe(0);
		});
	});

	describe("single node", () => {
		it("should place a single node in its own community", () => {
			const adjacency = new Map<string, Set<string>>();
			adjacency.set("A", new Set());

			const result = detectCommunities(adjacency);
			expect(result.communities.size).toBe(1);

			const allNodes = [...result.communities.values()].flat();
			expect(allNodes).toContain("A");
		});
	});

	describe("two connected nodes", () => {
		it("should place two connected nodes in the same community", () => {
			const adjacency = new Map<string, Set<string>>();
			adjacency.set("A", new Set(["B"]));
			adjacency.set("B", new Set(["A"]));

			const result = detectCommunities(adjacency);

			// They should be in the same community
			const allMembers = [...result.communities.values()];
			const communityWithA = allMembers.find((m) => m.includes("A"));
			expect(communityWithA).toContain("B");
		});
	});

	describe("known graph with two clusters", () => {
		it("should detect two communities in a barbell graph", () => {
			// Barbell: A-B-C fully connected, D-E-F fully connected, C-D bridge
			const adjacency = new Map<string, Set<string>>();
			adjacency.set("A", new Set(["B", "C"]));
			adjacency.set("B", new Set(["A", "C"]));
			adjacency.set("C", new Set(["A", "B", "D"]));
			adjacency.set("D", new Set(["C", "E", "F"]));
			adjacency.set("E", new Set(["D", "F"]));
			adjacency.set("F", new Set(["D", "E"]));

			const result = detectCommunities(adjacency);

			// Should detect 2 communities
			expect(result.communities.size).toBe(2);

			// Verify each cluster is together
			const allMembers = [...result.communities.values()];
			const clusterWithA = allMembers.find((m) => m.includes("A"));
			const clusterWithD = allMembers.find((m) => m.includes("D"));

			expect(clusterWithA).toBeDefined();
			expect(clusterWithD).toBeDefined();
			expect(clusterWithA).toContain("B");
			expect(clusterWithA).toContain("C");
			expect(clusterWithD).toContain("E");
			expect(clusterWithD).toContain("F");
		});

		it("should have positive modularity for a clustered graph", () => {
			const adjacency = new Map<string, Set<string>>();
			adjacency.set("A", new Set(["B", "C"]));
			adjacency.set("B", new Set(["A", "C"]));
			adjacency.set("C", new Set(["A", "B", "D"]));
			adjacency.set("D", new Set(["C", "E", "F"]));
			adjacency.set("E", new Set(["D", "F"]));
			adjacency.set("F", new Set(["D", "E"]));

			const result = detectCommunities(adjacency);
			expect(result.modularity).toBeGreaterThan(0);
		});
	});

	describe("disconnected components", () => {
		it("should handle disconnected components correctly", () => {
			const adjacency = new Map<string, Set<string>>();
			// Component 1: A-B
			adjacency.set("A", new Set(["B"]));
			adjacency.set("B", new Set(["A"]));
			// Component 2: C-D
			adjacency.set("C", new Set(["D"]));
			adjacency.set("D", new Set(["C"]));
			// Isolated node
			adjacency.set("E", new Set());

			const result = detectCommunities(adjacency);

			// All nodes should be assigned to a community
			const allNodes = [...result.communities.values()].flat();
			expect(allNodes).toContain("A");
			expect(allNodes).toContain("B");
			expect(allNodes).toContain("C");
			expect(allNodes).toContain("D");
			expect(allNodes).toContain("E");
			expect(allNodes).toHaveLength(5);
		});

		it("should keep disconnected components in separate communities", () => {
			const adjacency = new Map<string, Set<string>>();
			adjacency.set("A", new Set(["B"]));
			adjacency.set("B", new Set(["A"]));
			adjacency.set("C", new Set(["D"]));
			adjacency.set("D", new Set(["C"]));

			const result = detectCommunities(adjacency);

			// A and B should be together, C and D should be together
			const allMembers = [...result.communities.values()];
			const withA = allMembers.find((m) => m.includes("A"));
			const withC = allMembers.find((m) => m.includes("C"));
			expect(withA).toContain("B");
			expect(withC).toContain("D");
		});
	});

	describe("determinism", () => {
		it("should produce the same result on repeated runs", () => {
			const adjacency = new Map<string, Set<string>>();
			adjacency.set("A", new Set(["B", "C"]));
			adjacency.set("B", new Set(["A", "C"]));
			adjacency.set("C", new Set(["A", "B", "D"]));
			adjacency.set("D", new Set(["C", "E"]));
			adjacency.set("E", new Set(["D"]));

			const result1 = detectCommunities(adjacency);
			const result2 = detectCommunities(adjacency);

			expect(result1.communities.size).toBe(result2.communities.size);
			expect(result1.modularity).toBe(result2.modularity);

			for (const [key, members1] of result1.communities) {
				const members2 = result2.communities.get(key);
				expect(members2).toBeDefined();
				expect(members1).toEqual(members2 ?? []);
			}
		});
	});

	describe("performance", () => {
		it("should handle 1000+ nodes in under 1 second", () => {
			const nodeCount = 1000;
			const adjacency = new Map<string, Set<string>>();

			// Create a graph with 10 clusters of 100 nodes each
			for (let cluster = 0; cluster < 10; cluster++) {
				for (let i = 0; i < 100; i++) {
					const nodeId = `node-${cluster}-${i}`;
					const neighbors = new Set<string>();

					// Connect to ~10 nodes within the cluster
					for (let j = 0; j < 10; j++) {
						const neighborIdx = (i + j + 1) % 100;
						neighbors.add(`node-${cluster}-${neighborIdx}`);
					}

					// One cross-cluster connection
					if (i === 0 && cluster < 9) {
						neighbors.add(`node-${cluster + 1}-0`);
						// Also add the reverse connection
						const nextNode = adjacency.get(`node-${cluster + 1}-0`);
						if (nextNode) {
							nextNode.add(nodeId);
						}
					}

					adjacency.set(nodeId, neighbors);
				}
			}

			// Ensure reverse edges for cross-cluster
			for (let cluster = 0; cluster < 9; cluster++) {
				const targetNode = adjacency.get(`node-${cluster + 1}-0`);
				if (targetNode) {
					targetNode.add(`node-${cluster}-0`);
				}
			}

			const start = performance.now();
			const result = detectCommunities(adjacency);
			const elapsed = performance.now() - start;

			expect(elapsed).toBeLessThan(1000);
			expect(result.communities.size).toBeGreaterThan(0);

			// All 1000 nodes should be assigned
			const allNodes = [...result.communities.values()].flat();
			expect(allNodes).toHaveLength(nodeCount);
		});
	});

	describe("community numbering", () => {
		it("should number communities starting from 0", () => {
			const adjacency = new Map<string, Set<string>>();
			adjacency.set("A", new Set(["B"]));
			adjacency.set("B", new Set(["A"]));
			adjacency.set("C", new Set(["D"]));
			adjacency.set("D", new Set(["C"]));

			const result = detectCommunities(adjacency);
			const keys = [...result.communities.keys()].sort((a, b) => a - b);
			expect(keys[0]).toBe(0);
		});

		it("should have contiguous community IDs", () => {
			const adjacency = new Map<string, Set<string>>();
			adjacency.set("A", new Set(["B"]));
			adjacency.set("B", new Set(["A"]));
			adjacency.set("C", new Set());

			const result = detectCommunities(adjacency);
			const keys = [...result.communities.keys()].sort((a, b) => a - b);
			for (let i = 0; i < keys.length; i++) {
				expect(keys[i]).toBe(i);
			}
		});
	});
});
