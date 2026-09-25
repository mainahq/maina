/**
 * Issue #291: agent identity comes from an injected `EnvPort` and the HEAD
 * trailer read through the `GitPort`, never from `process.env` or a spawn
 * in the ambient working directory.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createFakeEnv, createFakeGit } from "../../ports/testing";
import { detectAgent } from "../agent-id";

const HEAD_MESSAGE = "log -1 --pretty=format:%B";

let saved: string | undefined;

beforeEach(() => {
	saved = process.env.MAINA_AGENT_ID;
	process.env.MAINA_AGENT_ID = "leaked:agent";
});

afterEach(() => {
	if (saved === undefined) delete process.env.MAINA_AGENT_ID;
	else process.env.MAINA_AGENT_ID = saved;
});

describe("detectAgent with injected ports", () => {
	test("uses MAINA_AGENT_ID from the injected env", async () => {
		const git = createFakeGit();
		const agent = await detectAgent({
			cwd: "/repo",
			env: createFakeEnv({ MAINA_AGENT_ID: "ci:bot", MAINA_AGENT_MODEL: "m1" }),
			git,
		});
		expect(agent).toEqual({ id: "ci:bot", modelVersion: "m1" });
		expect(git.calls()).toEqual([]);
	});

	test("falls back to the HEAD trailer read in the given root", async () => {
		const git = createFakeGit({
			[HEAD_MESSAGE]: "feat: x\n\nAgent: claude-code:opus",
		});
		const agent = await detectAgent({
			cwd: "/repo",
			env: createFakeEnv(),
			git,
		});
		expect(agent.id).toBe("claude-code:opus");
		expect(git.calls()).toEqual([
			{ root: "/repo", args: ["log", "-1", "--pretty=format:%B"] },
		]);
	});

	test("falls back to ci:unknown when neither env nor trailer names one", async () => {
		const agent = await detectAgent({
			cwd: "/repo",
			env: createFakeEnv(),
			git: createFakeGit({ [HEAD_MESSAGE]: "chore: nothing" }),
		});
		expect(agent).toEqual({ id: "ci:unknown", modelVersion: "unknown" });
	});
});
