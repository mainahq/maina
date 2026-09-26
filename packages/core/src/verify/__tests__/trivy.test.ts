import { describe, expect, it } from "bun:test";
import { createFakeProcess } from "../../ports/testing";
import { parseTrivyJson, runTrivy } from "../trivy";

// ─── parseTrivyJson ────────────────────────────────────────────────────────

describe("parseTrivyJson", () => {
	it("should return empty array for empty results", () => {
		const json = JSON.stringify({ Results: [] });
		const findings = parseTrivyJson(json);
		expect(findings).toEqual([]);
	});

	it("should parse vulnerabilities from Trivy JSON output", () => {
		const json = JSON.stringify({
			Results: [
				{
					Target: "package-lock.json",
					Type: "npm",
					Vulnerabilities: [
						{
							VulnerabilityID: "CVE-2023-12345",
							PkgName: "lodash",
							InstalledVersion: "4.17.20",
							FixedVersion: "4.17.21",
							Severity: "HIGH",
							Title: "Prototype Pollution in lodash",
							Description: "lodash before 4.17.21 allows prototype pollution.",
						},
					],
				},
			],
		});

		const findings = parseTrivyJson(json);
		expect(findings.length).toBe(1);
		expect(findings[0]?.tool).toBe("trivy");
		expect(findings[0]?.file).toBe("package-lock.json");
		expect(findings[0]?.line).toBe(0);
		expect(findings[0]?.severity).toBe("error");
		expect(findings[0]?.ruleId).toBe("CVE-2023-12345");
		expect(findings[0]?.message).toContain("lodash");
		expect(findings[0]?.message).toContain("4.17.20");
	});

	it("should map Trivy severity levels correctly", () => {
		const makeTrivy = (severity: string) =>
			JSON.stringify({
				Results: [
					{
						Target: "package.json",
						Vulnerabilities: [
							{
								VulnerabilityID: "CVE-0000-0000",
								PkgName: "pkg",
								InstalledVersion: "1.0.0",
								Severity: severity,
								Title: "Test",
							},
						],
					},
				],
			});

		expect(parseTrivyJson(makeTrivy("CRITICAL"))[0]?.severity).toBe("error");
		expect(parseTrivyJson(makeTrivy("HIGH"))[0]?.severity).toBe("error");
		expect(parseTrivyJson(makeTrivy("MEDIUM"))[0]?.severity).toBe("warning");
		expect(parseTrivyJson(makeTrivy("LOW"))[0]?.severity).toBe("info");
		expect(parseTrivyJson(makeTrivy("UNKNOWN"))[0]?.severity).toBe("info");
	});

	it("should handle multiple targets with multiple vulnerabilities", () => {
		const json = JSON.stringify({
			Results: [
				{
					Target: "package-lock.json",
					Vulnerabilities: [
						{
							VulnerabilityID: "CVE-2023-001",
							PkgName: "pkg-a",
							InstalledVersion: "1.0.0",
							Severity: "HIGH",
							Title: "Issue A",
						},
						{
							VulnerabilityID: "CVE-2023-002",
							PkgName: "pkg-b",
							InstalledVersion: "2.0.0",
							Severity: "LOW",
							Title: "Issue B",
						},
					],
				},
				{
					Target: "yarn.lock",
					Vulnerabilities: [
						{
							VulnerabilityID: "CVE-2023-003",
							PkgName: "pkg-c",
							InstalledVersion: "3.0.0",
							Severity: "CRITICAL",
							Title: "Issue C",
						},
					],
				},
			],
		});

		const findings = parseTrivyJson(json);
		expect(findings.length).toBe(3);
		expect(findings[0]?.file).toBe("package-lock.json");
		expect(findings[2]?.file).toBe("yarn.lock");
	});

	it("should handle targets with null vulnerabilities", () => {
		const json = JSON.stringify({
			Results: [
				{
					Target: "package.json",
					Vulnerabilities: null,
				},
			],
		});
		const findings = parseTrivyJson(json);
		expect(findings).toEqual([]);
	});

	it("should return empty array for invalid JSON", () => {
		const findings = parseTrivyJson("not valid json {{{");
		expect(findings).toEqual([]);
	});

	it("should return empty array for malformed structure", () => {
		const findings = parseTrivyJson(JSON.stringify({ unexpected: true }));
		expect(findings).toEqual([]);
	});

	it("should include fix version in message when available", () => {
		const json = JSON.stringify({
			Results: [
				{
					Target: "package.json",
					Vulnerabilities: [
						{
							VulnerabilityID: "CVE-2023-999",
							PkgName: "express",
							InstalledVersion: "4.17.0",
							FixedVersion: "4.18.0",
							Severity: "HIGH",
							Title: "Security issue",
						},
					],
				},
			],
		});

		const findings = parseTrivyJson(json);
		expect(findings[0]?.message).toContain("4.18.0");
	});
});

// ─── runTrivy ──────────────────────────────────────────────────────────────

// The runner is driven through a scripted ProcessPort, never the real
// binary: a real `trivy fs .` over the repository took longer than the 5s
// test timeout (#544).
const TRIVY_ARGV = "trivy fs --format json --scanners vuln .";

describe("runTrivy", () => {
	it("should skip without spawning when trivy is not installed", async () => {
		const proc = createFakeProcess();
		const result = await runTrivy({
			cwd: "/repo",
			available: false,
			process: proc,
		});
		expect(result).toEqual({ findings: [], skipped: true });
		expect(proc.calls()).toEqual([]);
	});

	it("should scan the root and parse the JSON on stdout", async () => {
		const proc = createFakeProcess({
			[TRIVY_ARGV]: {
				stdout: JSON.stringify({
					Results: [
						{
							Target: "bun.lock",
							Vulnerabilities: [
								{
									VulnerabilityID: "CVE-2024-0001",
									PkgName: "lodash",
									InstalledVersion: "4.17.20",
									Severity: "HIGH",
									Title: "Prototype pollution",
								},
							],
						},
					],
				}),
			},
		});
		const result = await runTrivy({
			cwd: "/repo",
			available: true,
			process: proc,
		});
		expect(result.skipped).toBe(false);
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.ruleId).toBe("CVE-2024-0001");
		expect(proc.calls()).toEqual([
			{ argv: TRIVY_ARGV.split(" "), options: { cwd: "/repo" } },
		]);
	});

	it("should report a failed run with no JSON as skipped with a notice", async () => {
		const proc = createFakeProcess({
			[TRIVY_ARGV]: { exitCode: 1, stderr: "db download failed" },
		});
		const result = await runTrivy({
			cwd: "/repo",
			available: true,
			process: proc,
		});
		expect(result.skipped).toBe(true);
		expect(result.findings).toEqual([]);
		expect(result.notice).toContain("db download failed");
	});
});
