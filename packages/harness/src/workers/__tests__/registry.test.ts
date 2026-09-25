import { describe, expect, test } from "bun:test";
import type { WorkerProbe } from "../probe";
import {
	detectInstalled,
	resolveWorker,
	WORKER_NAMES,
	type WorkerSpec,
} from "../registry";
import { MIN_ADAPTER_VERSIONS } from "../versions";

/** A fake PATH: `binaries` maps a binary to what `--version` prints. */
function probe(binaries: Readonly<Record<string, string | null>>): WorkerProbe {
	return {
		which: (binary) => (binary in binaries ? `/opt/bin/${binary}` : null),
		version: (path) => {
			const binary = path.slice("/opt/bin/".length);
			return binaries[binary] ?? null;
		},
	};
}

const ALL_ACP = probe({
	"claude-agent-acp": "0.81.2",
	"codex-acp": "@agentclientprotocol/codex-acp 1.13.1",
	agent: "2026.09.01-4f2a9c1",
	gemini: "0.61.0",
	opencode: "1.18.32",
});

function resolved(name: string, on: WorkerProbe = ALL_ACP): WorkerSpec {
	const result = resolveWorker(name, on);
	if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
	return result.value;
}

describe("resolveWorker: ACP agents", () => {
	test.each([
		["claude", "/opt/bin/claude-agent-acp", []],
		["codex", "/opt/bin/codex-acp", []],
		["cursor", "/opt/bin/agent", ["acp"]],
		["gemini", "/opt/bin/gemini", ["--acp"]],
		["opencode", "/opt/bin/opencode", ["acp"]],
	] as const)("%s resolves to its ACP launch spec", (name, command, args) => {
		const spec = resolved(name);
		expect(spec.name).toBe(name);
		expect(spec.protocol).toBe("acp");
		expect(spec.enforcement).toBe("gate");
		expect(spec.launch).toEqual({ name, command, args: [...args] });
		expect(spec.capabilities.permissionRequests).toBe(true);
	});

	test("the resolved spec carries the installed adapter version", () => {
		expect(resolved("codex").version).toBe("1.13.1");
		expect(resolved("cursor").version).toBe("2026.09.01");
	});

	test("cursor falls back to the cursor-agent binary", () => {
		const spec = resolved("cursor", probe({ "cursor-agent": "2026.09.01" }));
		expect(spec.launch.command).toBe("/opt/bin/cursor-agent");
		expect(spec.launch.args).toEqual(["acp"]);
	});

	test("an unreadable version still resolves; the handshake guards it", () => {
		const spec = resolved("claude", probe({ "claude-agent-acp": null }));
		expect(spec.version).toBeUndefined();
	});
});

describe("resolveWorker: missing, outdated, unknown", () => {
	test("a missing agent is an install hint, not a crash", () => {
		const result = resolveWorker("codex", probe({}));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("not_installed");
		expect(result.error.message).toContain("codex-acp");
		expect(result.error.hint).toContain(
			"npm install -g @agentclientprotocol/codex-acp",
		);
	});

	test.each(
		WORKER_NAMES.map((name) => [name]),
	)("every agent has an install hint (%s)", (name) => {
		const result = resolveWorker(name, probe({}));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("not_installed");
		expect(result.error.hint?.length ?? 0).toBeGreaterThan(0);
	});

	test("an adapter below the pinned minimum is refused with an upgrade hint", () => {
		const result = resolveWorker(
			"claude",
			probe({ "claude-agent-acp": "0.24.0" }),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("outdated");
		expect(result.error.message).toContain("0.24.0");
		expect(result.error.message).toContain(
			MIN_ADAPTER_VERSIONS.claude ?? "unreachable",
		);
		expect(result.error.hint).toContain(
			"@agentclientprotocol/claude-agent-acp",
		);
	});

	test("the minimum itself is accepted", () => {
		const min = MIN_ADAPTER_VERSIONS.gemini ?? "unreachable";
		expect(resolved("gemini", probe({ gemini: min })).version).toBe(min);
	});

	// The first release that meets each pin's stated reason, checked against
	// the published packages: claude-agent-acp 0.52.0 and codex-acp 1.0.1
	// are the first on `@agentclientprotocol/sdk` 1.x, gemini-cli 0.33.0 the
	// first with `--acp`. A working install must not be called outdated.
	test.each([
		["claude", "claude-agent-acp", "0.52.0", "0.51.0"],
		["codex", "codex-acp", "1.0.1", "1.0.0"],
		["gemini", "gemini", "0.33.0", "0.32.0"],
	] as const)("%s: %s %s is accepted, %s is not", (name, binary, first, before) => {
		expect(resolved(name, probe({ [binary]: first })).version).toBe(first);
		const old = resolveWorker(name, probe({ [binary]: before }));
		expect(old.ok ? "resolved" : old.error.code).toBe("outdated");
	});

	test("an unknown worker names the supported ones", () => {
		const result = resolveWorker("aider", ALL_ACP);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("unknown_worker");
		for (const name of WORKER_NAMES) {
			expect(result.error.message).toContain(name);
		}
	});
});

describe("resolveWorker: headless fallback", () => {
	test("is marked sandbox-only: nothing asks the gate before acting", () => {
		const spec = resolved("headless:claude", probe({ claude: "2.1.0" }));
		expect(spec.name).toBe("headless:claude");
		expect(spec.protocol).toBe("headless");
		expect(spec.enforcement).toBe("sandbox-only");
		expect(spec.capabilities.permissionRequests).toBe(false);
		expect(spec.launch.command).toBe("/opt/bin/claude");
		expect(spec.launch.args).toContain("-p");
	});

	test.each(
		WORKER_NAMES.map((name) => [name]),
	)("every headless fallback is sandbox-only (%s)", (name) => {
		const cli = probe({
			claude: "2.1.0",
			codex: "0.156.1",
			agent: "2026.09.01",
			gemini: "0.61.0",
			opencode: "1.18.32",
		});
		const spec = resolved(`headless:${name}`, cli);
		expect(spec.protocol).toBe("headless");
		expect(spec.enforcement).toBe("sandbox-only");
		expect(spec.taskVia === "stdin" || spec.taskVia === "argument").toBe(true);
	});

	test("a missing vendor CLI hints at the CLI, not the ACP adapter", () => {
		const result = resolveWorker(
			"headless:codex",
			probe({ "codex-acp": "1.13.1" }),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("not_installed");
		expect(result.error.hint).toContain("@openai/codex");
	});

	test("ACP workers take the task over session/prompt", () => {
		expect(resolved("claude").taskVia).toBe("acp");
	});
});

describe("inner sandbox", () => {
	test("says how to turn each agent's own sandbox off", () => {
		expect(resolved("codex").innerSandbox).toMatchObject({
			kind: "os",
			disable: {
				env: { INITIAL_AGENT_MODE: "agent-full-access" },
				stopsPermissionRequests: true,
			},
		});
		expect(resolved("gemini").innerSandbox).toMatchObject({
			kind: "container",
			enabledByDefault: false,
			disable: { env: { GEMINI_SANDBOX: "false" } },
		});
		expect(resolved("cursor").innerSandbox.disable.args).toEqual([
			"--sandbox",
			"disabled",
		]);
		expect(resolved("opencode").innerSandbox.kind).toBe("none");
	});
});

describe("minimum adapter versions", () => {
	test("are pinned in one table covering every ACP agent", () => {
		expect(Object.keys(MIN_ADAPTER_VERSIONS).sort()).toEqual(
			[...WORKER_NAMES].sort(),
		);
	});
});

describe("detectInstalled", () => {
	test("lists only installed, recent-enough workers, ACP first", () => {
		const found = detectInstalled(
			probe({
				"claude-agent-acp": "0.81.2",
				"codex-acp": "1.0.0", // below the pin: skipped
				claude: "2.1.0",
				gemini: "0.61.0",
			}),
		);
		expect(found.map((spec) => spec.name)).toEqual([
			"claude",
			"gemini",
			"headless:claude",
			"headless:gemini",
		]);
	});

	test("finds nothing on an empty PATH, without throwing", () => {
		expect(detectInstalled(probe({}))).toEqual([]);
	});
});
