import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeProcess } from "../../ports/testing";
import { parseSonarReport, runSonar } from "../sonar";

const OK = { exitCode: 0, stdout: "", stderr: "" };

describe("SonarQube Integration", () => {
	describe("parseSonarReport", () => {
		it("should parse SonarQube JSON issues into findings", () => {
			const json = JSON.stringify({
				issues: [
					{
						rule: "typescript:S1854",
						severity: "MAJOR",
						component: "src/app.ts",
						line: 42,
						message: 'Remove this useless assignment to local variable "x".',
					},
					{
						rule: "typescript:S3776",
						severity: "CRITICAL",
						component: "src/utils.ts",
						line: 10,
						message:
							"Refactor this function to reduce its Cognitive Complexity.",
					},
				],
			});

			const findings = parseSonarReport(json);

			expect(findings).toHaveLength(2);
			expect(findings[0]?.tool).toBe("sonarqube");
			expect(findings[0]?.file).toBe("src/app.ts");
			expect(findings[0]?.line).toBe(42);
			expect(findings[0]?.severity).toBe("warning");
			expect(findings[0]?.ruleId).toBe("typescript:S1854");
			expect(findings[1]?.severity).toBe("error");
		});

		it("should handle empty issues array", () => {
			const json = JSON.stringify({ issues: [] });
			expect(parseSonarReport(json)).toHaveLength(0);
		});

		it("should handle malformed JSON", () => {
			expect(parseSonarReport("not json")).toHaveLength(0);
		});

		it("should handle missing fields gracefully", () => {
			const json = JSON.stringify({
				issues: [{ rule: "test:rule" }],
			});
			const findings = parseSonarReport(json);
			expect(findings).toHaveLength(1);
			expect(findings[0]?.file).toBe("");
			expect(findings[0]?.line).toBe(0);
		});

		it("should map SonarQube severities correctly", () => {
			const json = JSON.stringify({
				issues: [
					{
						rule: "r1",
						severity: "BLOCKER",
						component: "a.ts",
						line: 1,
						message: "blocker",
					},
					{
						rule: "r2",
						severity: "CRITICAL",
						component: "a.ts",
						line: 2,
						message: "critical",
					},
					{
						rule: "r3",
						severity: "MAJOR",
						component: "a.ts",
						line: 3,
						message: "major",
					},
					{
						rule: "r4",
						severity: "MINOR",
						component: "a.ts",
						line: 4,
						message: "minor",
					},
					{
						rule: "r5",
						severity: "INFO",
						component: "a.ts",
						line: 5,
						message: "info",
					},
				],
			});
			const findings = parseSonarReport(json);
			expect(findings[0]?.severity).toBe("error"); // BLOCKER
			expect(findings[1]?.severity).toBe("error"); // CRITICAL
			expect(findings[2]?.severity).toBe("warning"); // MAJOR
			expect(findings[3]?.severity).toBe("warning"); // MINOR
			expect(findings[4]?.severity).toBe("info"); // INFO
		});
	});

	describe("runSonar", () => {
		let root: string;

		beforeEach(() => {
			root = mkdtempSync(join(tmpdir(), "maina-544-sonar-"));
		});

		afterEach(() => {
			rmSync(root, { recursive: true, force: true });
		});

		/** Records every spawn and answers each with exit 0. */
		const recording = () => createFakeProcess(() => ({ ok: true, value: OK }));

		it("should skip when sonarqube is not available", async () => {
			const result = await runSonar({ cwd: root, available: false });
			expect(result.skipped).toBe(true);
			expect(result.findings).toHaveLength(0);
		});

		it("should skip quietly without spawning when the root has no sonar-project.properties (#544)", async () => {
			const proc = recording();
			const result = await runSonar({
				cwd: root,
				available: true,
				process: proc,
			});
			expect(result).toEqual({ findings: [], skipped: true });
			expect(proc.calls()).toEqual([]);
		});

		it("should not pass the removed preview analysis mode (#544)", async () => {
			writeFileSync(
				join(root, "sonar-project.properties"),
				"sonar.projectKey=x\n",
			);
			const proc = recording();
			await runSonar({ cwd: root, available: true, process: proc });
			const argv = proc.calls()[0]?.argv ?? [];
			expect(argv[0]).toBe("sonar-scanner");
			expect(argv.some((a) => a.includes("sonar.analysis.mode"))).toBe(false);
			expect(argv.some((a) => a.includes("sonar.report.export.path"))).toBe(
				false,
			);
		});

		it("should report a run that left no local report as skipped with a notice, never a pass", async () => {
			// Since SonarQube 7 the issues live on the server, not in a local file.
			writeFileSync(
				join(root, "sonar-project.properties"),
				"sonar.projectKey=x\n",
			);
			const result = await runSonar({
				cwd: root,
				available: true,
				process: recording(),
			});
			expect(result.skipped).toBe(true);
			expect(result.findings).toEqual([]);
			expect(result.notice).toContain("sonarqube");
			expect(result.notice).toContain("server");
		});

		// Root reads a 0000 file anyway, so the unreadable report needs a non-root user.
		it.skipIf(process.getuid?.() === 0)(
			"should report a fresh report it cannot read as skipped with a notice, never a pass",
			async () => {
				writeFileSync(
					join(root, "sonar-project.properties"),
					"sonar.projectKey=x\n",
				);
				const report = join(root, ".scannerwork", "sonar-report.json");
				mkdirSync(join(root, ".scannerwork"));
				writeFileSync(report, '{"issues":[]}');
				chmodSync(report, 0o000);
				const result = await runSonar({
					cwd: root,
					available: true,
					process: recording(),
				});
				chmodSync(report, 0o600);
				expect(result.skipped).toBe(true);
				expect(result.findings).toEqual([]);
				expect(result.notice).toContain("sonarqube");
			},
		);
	});
});
