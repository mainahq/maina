import { describe, expect, test } from "bun:test";
import { type CredentialPlan, planCredentials } from "../credential-proxy";
import type { Credential } from "../port";

const KEY: Credential = {
	name: "ANTHROPIC_API_KEY",
	value: "sk-ant-real-316",
	hosts: ["api.anthropic.com"],
};

const AMBIENT = {
	PATH: "/usr/bin:/bin",
	HOME: "/home/dev",
	LANG: "en_US.UTF-8",
	LC_ALL: "en_US.UTF-8",
	TERM: "xterm-256color",
	TMPDIR: "/tmp",
	GITHUB_TOKEN: "ghp_ambient_316",
	AWS_SECRET_ACCESS_KEY: "aws-ambient-316",
	SOME_TOOL_CONFIG: "not-obviously-secret",
	HTTPS_PROXY: "http://corp-proxy:3128",
};

function plan(
	credentials: readonly Credential[],
	env: Readonly<Record<string, string | undefined>> = AMBIENT,
	launchEnv: Readonly<Record<string, string>> = {},
): CredentialPlan {
	const result = planCredentials(credentials, env, launchEnv);
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
}

const ruleFor = (p: CredentialPlan, name: string) =>
	p.envVars.find((rule) => rule.name === name);

describe("planCredentials: declared credentials", () => {
	test("the worker gets a stand-in; the real value goes only to its hosts", () => {
		const p = plan([KEY]);
		expect(ruleFor(p, "ANTHROPIC_API_KEY")).toEqual({
			name: "ANTHROPIC_API_KEY",
			mode: "mask",
			injectHosts: ["api.anthropic.com"],
		});
		expect(p.hosts).toEqual(["api.anthropic.com"]);
	});

	test("the real value lives only in the sandbox runtime's own environment", () => {
		const p = plan([KEY]);
		expect(p.hostEnv).toEqual({ ANTHROPIC_API_KEY: "sk-ant-real-316" });
		expect(JSON.stringify(p.envVars)).not.toContain("sk-ant-real-316");
	});

	test("hosts of several credentials are merged without duplicates", () => {
		const p = plan([
			KEY,
			{
				name: "ANTHROPIC_AUTH_TOKEN",
				value: "t",
				hosts: ["api.anthropic.com"],
			},
			{ name: "OPENAI_API_KEY", value: "o", hosts: ["api.openai.com"] },
		]);
		expect(p.hosts).toEqual(["api.anthropic.com", "api.openai.com"]);
	});
});

describe("planCredentials: ambient environment", () => {
	test("undeclared variables from the host are withheld from the worker", () => {
		const p = plan([KEY]);
		for (const name of [
			"GITHUB_TOKEN",
			"AWS_SECRET_ACCESS_KEY",
			"SOME_TOOL_CONFIG",
		]) {
			expect(ruleFor(p, name)).toEqual({ name, mode: "deny" });
		}
	});

	test("the basics a process needs pass through", () => {
		const p = plan([KEY]);
		for (const name of ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR"]) {
			expect(ruleFor(p, name)).toBeUndefined();
		}
	});

	test("proxy variables are left to the sandbox runtime, which rewrites them", () => {
		expect(ruleFor(plan([KEY]), "HTTPS_PROXY")).toBeUndefined();
	});

	test("the launch's own variables pass through", () => {
		const p = plan([], AMBIENT, { INITIAL_AGENT_MODE: "agent-full-access" });
		expect(ruleFor(p, "INITIAL_AGENT_MODE")).toBeUndefined();
	});

	test("unset variables are ignored", () => {
		expect(ruleFor(plan([], { EMPTY: undefined }), "EMPTY")).toBeUndefined();
	});

	test("no secret value appears anywhere in the rules", () => {
		const text = JSON.stringify(plan([KEY]).envVars);
		for (const value of ["ghp_ambient_316", "aws-ambient-316"]) {
			expect(text).not.toContain(value);
		}
	});
});

describe("planCredentials: refuses a credential it cannot protect", () => {
	test.each([
		["no hosts", { ...KEY, hosts: [] }],
		["an empty value", { ...KEY, value: "" }],
		["a name that is not an env var", { ...KEY, name: "NOT VALID" }],
		["a host that is not a host", { ...KEY, hosts: ["https://x/y z"] }],
	])("%s", (_label, credential) => {
		const result = planCredentials([credential], AMBIENT, {});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("invalid_options");
	});

	test("a credential the launch also sets", () => {
		const result = planCredentials([KEY], AMBIENT, {
			ANTHROPIC_API_KEY: "x",
		});
		expect(result.ok).toBe(false);
	});

	test("the same credential declared twice", () => {
		const result = planCredentials([KEY, KEY], AMBIENT, {});
		expect(result.ok).toBe(false);
	});
});
