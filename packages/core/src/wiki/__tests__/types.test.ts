import { describe, expect, it } from "bun:test";
import type {
	ArticleType,
	EdgeType,
	ExtractedDecision,
	ExtractedFeature,
	ExtractedWorkflowTrace,
	WikiArticle,
	WikiLink,
	WikiLintFinding,
	WikiLintResult,
	WikiState,
} from "../types";

describe("Wiki Types", () => {
	describe("WikiArticle", () => {
		it("happy path: should create a valid wiki article", () => {
			const article: WikiArticle = {
				path: "modules/auth.md",
				type: "module",
				title: "Auth Module",
				content: "# Auth Module\n\nHandles authentication.",
				contentHash: "abc123",
				sourceHashes: ["def456", "ghi789"],
				backlinks: [],
				forwardLinks: [],
				pageRank: 0.85,
				lastCompiled: "2026-04-07T00:00:00.000Z",
				referenceCount: 5,
				ebbinghausScore: 0.9,
			};

			expect(article.path).toBe("modules/auth.md");
			expect(article.type).toBe("module");
			expect(article.pageRank).toBe(0.85);
			expect(article.ebbinghausScore).toBe(0.9);
		});

		it("should support all 6 article types", () => {
			const types: ArticleType[] = [
				"module",
				"entity",
				"feature",
				"decision",
				"architecture",
				"raw",
			];
			expect(types).toHaveLength(6);
		});

		it("should support articles with forward and backward links", () => {
			const link: WikiLink = {
				target: "entities/runPipeline.md",
				type: "calls",
				weight: 0.7,
			};

			const article: WikiArticle = {
				path: "modules/verify.md",
				type: "module",
				title: "Verify Module",
				content: "# Verify",
				contentHash: "hash1",
				sourceHashes: ["hash2"],
				backlinks: [{ target: "modules/cli.md", type: "imports", weight: 0.5 }],
				forwardLinks: [link],
				pageRank: 0.6,
				lastCompiled: "2026-04-07T00:00:00.000Z",
				referenceCount: 3,
				ebbinghausScore: 0.75,
			};

			expect(article.forwardLinks).toHaveLength(1);
			expect(article.backlinks).toHaveLength(1);
			expect(article.forwardLinks[0]?.type).toBe("calls");
		});

		it("edge case: article with zero pageRank and expired ebbinghaus", () => {
			const article: WikiArticle = {
				path: "entities/deprecated.md",
				type: "entity",
				title: "Deprecated Entity",
				content: "",
				contentHash: "empty",
				sourceHashes: [],
				backlinks: [],
				forwardLinks: [],
				pageRank: 0,
				lastCompiled: "2025-01-01T00:00:00.000Z",
				referenceCount: 0,
				ebbinghausScore: 0.1,
			};

			expect(article.pageRank).toBe(0);
			expect(article.ebbinghausScore).toBeLessThan(0.2);
		});

		it("should serialize/deserialize via JSON round-trip", () => {
			const article: WikiArticle = {
				path: "features/001-auth.md",
				type: "feature",
				title: "Auth Feature",
				content: "# Auth\n\nToken refresh.",
				contentHash: "abc",
				sourceHashes: ["src1", "src2"],
				backlinks: [
					{ target: "entities/jwt.md", type: "modified_by", weight: 1.0 },
				],
				forwardLinks: [
					{ target: "decisions/002.md", type: "decided_by", weight: 0.8 },
				],
				pageRank: 0.5,
				lastCompiled: "2026-04-07T12:00:00.000Z",
				referenceCount: 10,
				ebbinghausScore: 0.65,
			};

			const json = JSON.stringify(article);
			const parsed: WikiArticle = JSON.parse(json);

			expect(parsed.path).toBe(article.path);
			expect(parsed.type).toBe(article.type);
			expect(parsed.backlinks).toHaveLength(1);
			expect(parsed.forwardLinks).toHaveLength(1);
			expect(parsed.backlinks[0]?.type).toBe("modified_by");
			expect(parsed.pageRank).toBe(0.5);
		});
	});

	describe("WikiLink", () => {
		it("should support all 11 edge types", () => {
			const edgeTypes: EdgeType[] = [
				"calls",
				"imports",
				"inherits",
				"references",
				"member_of",
				"modified_by",
				"specified_by",
				"decided_by",
				"motivated_by",
				"constrains",
				"aligns_with",
			];
			expect(edgeTypes).toHaveLength(11);
		});

		it("should have weight between 0 and 1", () => {
			const link: WikiLink = {
				target: "modules/core.md",
				type: "imports",
				weight: 0.5,
			};
			expect(link.weight).toBeGreaterThanOrEqual(0);
			expect(link.weight).toBeLessThanOrEqual(1);
		});
	});

	describe("ExtractedFeature", () => {
		it("happy path: should represent a fully extracted feature", () => {
			const feature: ExtractedFeature = {
				id: "001-token-refresh",
				title: "Token Refresh",
				scope: "Add automatic JWT token refresh to the auth module",
				specQualityScore: 85,
				specAssertions: [
					"Tokens refresh 5 minutes before expiry",
					"Failed refresh triggers re-login",
				],
				tasks: [
					{ id: "T001", description: "Add refresh timer", completed: false },
					{ id: "T002", description: "Wire error handler", completed: true },
				],
				entitiesModified: ["src/auth/jwt.ts", "src/auth/refresh.ts"],
				decisionsCreated: ["002-jwt-strategy"],
				branch: "feature/001-token-refresh",
				prNumber: 42,
				merged: true,
			};

			expect(feature.id).toBe("001-token-refresh");
			expect(feature.tasks).toHaveLength(2);
			expect(feature.specAssertions).toHaveLength(2);
			expect(feature.merged).toBe(true);
		});

		it("edge case: feature with no spec, no tasks, no PR", () => {
			const feature: ExtractedFeature = {
				id: "099-wip",
				title: "Work in Progress",
				scope: "",
				specQualityScore: 0,
				specAssertions: [],
				tasks: [],
				entitiesModified: [],
				decisionsCreated: [],
				branch: "",
				prNumber: null,
				merged: false,
			};

			expect(feature.specQualityScore).toBe(0);
			expect(feature.tasks).toHaveLength(0);
			expect(feature.prNumber).toBeNull();
		});
	});

	describe("ExtractedDecision", () => {
		it("happy path: should represent a fully extracted ADR", () => {
			const decision: ExtractedDecision = {
				id: "002-jwt-strategy",
				title: "Use JWT for Authentication",
				status: "accepted",
				context: "We need stateless auth for microservices.",
				decision: "Use JWT tokens with RS256 signing.",
				rationale: "Stateless, scalable, widely supported.",
				alternativesRejected: ["Session-based auth", "OAuth2 only"],
				entityMentions: ["src/auth/jwt.ts", "src/middleware/auth.ts"],
				constitutionAlignment: ["Error handling: Result<T,E>"],
			};

			expect(decision.status).toBe("accepted");
			expect(decision.alternativesRejected).toHaveLength(2);
			expect(decision.entityMentions).toHaveLength(2);
		});

		it("should support all 4 decision statuses", () => {
			const statuses: ExtractedDecision["status"][] = [
				"proposed",
				"accepted",
				"deprecated",
				"superseded",
			];
			expect(statuses).toHaveLength(4);
		});
	});

	describe("ExtractedWorkflowTrace", () => {
		it("happy path: should represent a workflow trace with wiki refs", () => {
			const trace: ExtractedWorkflowTrace = {
				featureId: "001-token-refresh",
				steps: [
					{
						command: "brainstorm",
						timestamp: "2026-04-07T10:00:00.000Z",
						summary: "Explored auth options",
					},
					{
						command: "plan",
						timestamp: "2026-04-07T10:30:00.000Z",
						summary: "Scaffolded feature",
					},
					{
						command: "commit",
						timestamp: "2026-04-07T12:00:00.000Z",
						summary: "Initial implementation",
					},
				],
				wikiRefsRead: ["wiki/modules/auth.md", "wiki/decisions/002.md"],
				wikiRefsWritten: ["wiki/features/001-token-refresh.md"],
				rlSignals: [
					{ step: "review", accepted: true },
					{ step: "verify", accepted: true },
				],
			};

			expect(trace.steps).toHaveLength(3);
			expect(trace.wikiRefsRead).toHaveLength(2);
			expect(trace.wikiRefsWritten).toHaveLength(1);
			expect(trace.rlSignals).toHaveLength(2);
		});

		it("edge case: empty workflow trace", () => {
			const trace: ExtractedWorkflowTrace = {
				featureId: "",
				steps: [],
				wikiRefsRead: [],
				wikiRefsWritten: [],
				rlSignals: [],
			};

			expect(trace.steps).toHaveLength(0);
			expect(trace.rlSignals).toHaveLength(0);
		});
	});

	describe("WikiState", () => {
		it("should serialize/deserialize state via JSON round-trip", () => {
			const state: WikiState = {
				fileHashes: {
					"src/auth/jwt.ts": "abc123",
					"src/auth/refresh.ts": "def456",
				},
				articleHashes: {
					"modules/auth.md": "ghi789",
				},
				lastFullCompile: "2026-04-07T00:00:00.000Z",
				lastIncrementalCompile: "2026-04-07T12:00:00.000Z",
				compilationPromptHash: "prompt_hash_v1",
			};

			const json = JSON.stringify(state);
			const parsed: WikiState = JSON.parse(json);

			expect(parsed.fileHashes["src/auth/jwt.ts"]).toBe("abc123");
			expect(parsed.articleHashes["modules/auth.md"]).toBe("ghi789");
			expect(parsed.lastFullCompile).toBe("2026-04-07T00:00:00.000Z");
			expect(parsed.compilationPromptHash).toBe("prompt_hash_v1");
		});

		it("edge case: empty state", () => {
			const state: WikiState = {
				fileHashes: {},
				articleHashes: {},
				lastFullCompile: "",
				lastIncrementalCompile: "",
				compilationPromptHash: "",
			};

			expect(Object.keys(state.fileHashes)).toHaveLength(0);
			expect(state.lastFullCompile).toBe("");
		});
	});

	describe("WikiLintResult", () => {
		it("happy path: should represent a full lint result", () => {
			const finding: WikiLintFinding = {
				check: "stale",
				severity: "warning",
				article: "modules/auth.md",
				message: "Article not recompiled since source changed",
				source: "src/auth/jwt.ts",
			};

			const result: WikiLintResult = {
				stale: [finding],
				orphans: [],
				gaps: [
					{
						check: "gap",
						severity: "info",
						article: "",
						message: "High-PageRank entity without article",
						source: "src/verify/pipeline.ts",
					},
				],
				brokenLinks: [],
				contradictions: [],
				specDrift: [],
				decisionViolations: [],
				missingRationale: [],
				coveragePercent: 72.5,
			};

			expect(result.stale).toHaveLength(1);
			expect(result.gaps).toHaveLength(1);
			expect(result.coveragePercent).toBe(72.5);
			expect(result.brokenLinks).toHaveLength(0);
		});

		it("edge case: perfect lint result", () => {
			const result: WikiLintResult = {
				stale: [],
				orphans: [],
				gaps: [],
				brokenLinks: [],
				contradictions: [],
				specDrift: [],
				decisionViolations: [],
				missingRationale: [],
				coveragePercent: 100,
			};

			expect(result.coveragePercent).toBe(100);
			const totalFindings =
				result.stale.length +
				result.orphans.length +
				result.gaps.length +
				result.brokenLinks.length +
				result.contradictions.length +
				result.specDrift.length +
				result.decisionViolations.length +
				result.missingRationale.length;
			expect(totalFindings).toBe(0);
		});
	});
});
