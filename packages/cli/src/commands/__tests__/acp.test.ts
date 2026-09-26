import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "@mainahq/core";
import type { ProxyReceipt } from "@mainahq/harness/src/proxy/server";
import type { WorkerSpec } from "@mainahq/harness/src/workers/registry";
import { type AcpActionDeps, acpAction, acpCommand } from "../acp";

const CLAUDE: WorkerSpec = {
	name: "claude",
	launch: { name: "claude", command: "/bin/claude-agent-acp", args: [] },
	protocol: "acp",
	enforcement: "gate",
	taskVia: "acp",
	capabilities: { permissionRequests: true, toolCallReports: true },
	innerSandbox: { kind: "os", enabledByDefault: false, disable: {} },
};

const RECEIPT: ProxyReceipt = {
	agent: "claude",
	endedBy: "editor",
	startedAt: 1,
	endedAt: 2,
	sessions: [],
	permissions: [],
};

type Seen = {
	bridges: Array<{ context: string; logFile: string }>;
	proxied: Array<{ command: string; root: string }>;
	written: Array<{ path: string; content: string }>;
};

function deps(overrides: Partial<AcpActionDeps> = {}): {
	deps: AcpActionDeps;
	seen: Seen;
} {
	const seen: Seen = { bridges: [], proxied: [], written: [] };
	return {
		seen,
		deps: {
			repoRoot: async (cwd) => ({ ok: true, value: `${cwd}/root` }),
			loadPolicy: async () => ({ ok: true, value: DEFAULT_POLICY }),
			resolveWorker: () => ({ ok: true, value: CLAUDE }),
			newSessionId: () => "acp-1",
			createBridge: async (input) => {
				seen.bridges.push({ context: input.context, logFile: input.logFile });
				return {
					ports: {} as never,
					policy: input.policy,
					log: () => undefined,
					context: input.context,
				};
			},
			proxy: async (input) => {
				seen.proxied.push({ command: input.agent.command, root: input.root });
				return { ok: true, value: RECEIPT };
			},
			writeFile: async (path, content) => {
				seen.written.push({ path, content });
				return { ok: true, value: undefined };
			},
			...overrides,
		},
	};
}

describe("acpAction", () => {
	test("proxies the resolved ACP worker through an interactive gate and writes the receipt", async () => {
		const { deps: d, seen } = deps();
		const result = await acpAction({ agent: "claude", cwd: "/work" }, d);

		expect(result).toMatchObject({
			ok: true,
			receiptPath: "/work/root/.maina/runs/acp-1.json",
		});
		expect(seen.proxied).toEqual([
			{ command: "/bin/claude-agent-acp", root: "/work/root" },
		]);
		// A person is in the editor to answer an ask.
		expect(seen.bridges).toEqual([
			{
				context: "interactive",
				logFile: "/work/root/.maina/runs/acp-1.permissions.jsonl",
			},
		]);
		expect(seen.written).toHaveLength(1);
		expect(JSON.parse(seen.written[0]?.content ?? "")).toEqual({
			runId: "acp-1",
			mode: "acp",
			...RECEIPT,
		});
	});

	test("outside a git repo the working directory is the root", async () => {
		const { deps: d, seen } = deps({
			repoRoot: async () => ({ ok: false, error: { message: "not a repo" } }),
		});
		const result = await acpAction({ agent: "claude", cwd: "/scratch" }, d);
		expect(result).toMatchObject({
			ok: true,
			receiptPath: "/scratch/.maina/runs/acp-1.json",
		});
		expect(seen.proxied[0]?.root).toBe("/scratch");
	});

	test("an unknown or missing agent is an error with its fix, and nothing is started", async () => {
		const { deps: d, seen } = deps({
			resolveWorker: () => ({
				ok: false,
				error: {
					code: "not_installed",
					message: "claude-agent-acp is not on PATH",
					hint: "npm install -g @agentclientprotocol/claude-agent-acp",
				},
			}),
		});
		const result = await acpAction({ agent: "claude", cwd: "/work" }, d);
		expect(result).toEqual({
			ok: false,
			error: {
				kind: "worker",
				message: "claude-agent-acp is not on PATH",
				hint: "npm install -g @agentclientprotocol/claude-agent-acp",
			},
		});
		expect(seen.proxied).toEqual([]);
	});

	test("a headless worker is refused: the gate cannot answer for it", async () => {
		const { deps: d, seen } = deps({
			resolveWorker: () => ({
				ok: true,
				value: { ...CLAUDE, protocol: "headless", enforcement: "sandbox-only" },
			}),
		});
		const result = await acpAction({ agent: "headless:claude", cwd: "/w" }, d);
		expect(result).toMatchObject({ ok: false, error: { kind: "worker" } });
		expect(seen.proxied).toEqual([]);
	});

	test("an invalid policy is an error, and nothing is started", async () => {
		const { deps: d, seen } = deps({
			loadPolicy: async () => ({
				ok: false,
				error: [
					{
						source: "repo",
						file: "policy.yaml",
						path: "rules",
						message: "bad",
					},
				] as never,
			}),
		});
		const result = await acpAction({ agent: "claude", cwd: "/w" }, d);
		expect(result).toMatchObject({ ok: false, error: { kind: "policy" } });
		expect(seen.proxied).toEqual([]);
	});

	test("an agent that fails to start is an error, with no receipt", async () => {
		const { deps: d, seen } = deps({
			proxy: async () => ({
				ok: false,
				error: { code: "spawn_failed", message: "could not start agent" },
			}),
		});
		const result = await acpAction({ agent: "claude", cwd: "/w" }, d);
		expect(result).toEqual({
			ok: false,
			error: { kind: "agent", message: "could not start agent" },
		});
		expect(seen.written).toEqual([]);
	});
});

describe("acpCommand", () => {
	test("maina acp takes --agent, defaulting to claude", () => {
		const cmd = acpCommand();
		expect(cmd.name()).toBe("acp");
		const agent = cmd.options.find((o) => o.long === "--agent");
		expect(agent?.defaultValue).toBe("claude");
	});
});
