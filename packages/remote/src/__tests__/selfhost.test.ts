/**
 * The self-host setup check (FR-REM-4): the image reads the operator's
 * policy file and model artifacts from `$HOME/.maina`, the same layout a
 * local install uses. Both processes check it at startup and refuse to
 * start on a broken policy, so a typo never silently falls back to the
 * defaults, and a policy that opts into telemetry is refused outright: a
 * self-hosted install sends nothing anywhere but GitHub.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { systemFs } from "@mainahq/core";
import {
	checkSelfHost,
	describeSelfHost,
	describeSelfHostError,
} from "../selfhost";

let home: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "maina-selfhost-"));
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
});

const policyFile = () => join(home, ".maina", "policy.json");
const modelDir = () => join(home, ".maina", "models");

function writePolicy(body: string): void {
	mkdirSync(join(home, ".maina"), { recursive: true });
	writeFileSync(policyFile(), body);
}

describe("checkSelfHost", () => {
	test("no policy and no model: built-in defaults, no artifacts", async () => {
		const setup = await checkSelfHost(systemFs, home);
		expect(setup).toEqual({
			ok: true,
			value: {
				policy: { file: policyFile(), state: "absent" },
				model: { dir: modelDir(), files: [] },
			},
		});
	});

	test("a valid policy file and a model artifact are found", async () => {
		writePolicy(
			JSON.stringify({
				version: 1,
				protected_branches: ["release"],
				decisions: { "review.reviewer_kind": { backend: "system1" } },
			}),
		);
		mkdirSync(modelDir(), { recursive: true });
		writeFileSync(join(modelDir(), "system1.onnx"), "stub");
		writeFileSync(join(modelDir(), "system1.sig"), "stub");
		// Hidden entries (a .gitkeep, say) are not artifacts.
		writeFileSync(join(modelDir(), ".gitkeep"), "");

		const setup = await checkSelfHost(systemFs, home);
		expect(setup).toEqual({
			ok: true,
			value: {
				policy: { file: policyFile(), state: "valid" },
				model: {
					dir: modelDir(),
					files: ["system1.onnx", "system1.sig"],
				},
			},
		});
	});

	test("a policy that does not parse refuses to start, naming the file", async () => {
		writePolicy("{ not json");
		const setup = await checkSelfHost(systemFs, home);
		expect(setup.ok).toBe(false);
		if (setup.ok) return;
		expect(setup.error.kind).toBe("policy");
		expect(describeSelfHostError(setup.error)).toContain(policyFile());
	});

	test("a policy that breaks the schema refuses to start, naming the key", async () => {
		writePolicy(JSON.stringify({ protected_branch: ["main"] }));
		const setup = await checkSelfHost(systemFs, home);
		expect(setup.ok).toBe(false);
		if (setup.ok) return;
		expect(setup.error.kind).toBe("policy");
		const text = describeSelfHostError(setup.error);
		expect(text).toContain(policyFile());
		expect(text).toContain("protected_branch");
	});

	test("a policy that opts into telemetry is refused: nothing leaves but GitHub traffic", async () => {
		writePolicy(JSON.stringify({ telemetry: { crash_reports: true } }));
		const setup = await checkSelfHost(systemFs, home);
		expect(setup.ok).toBe(false);
		if (setup.ok) return;
		expect(setup.error).toEqual({
			kind: "telemetry",
			file: policyFile(),
			optIns: ["crash_reports"],
		});
		const text = describeSelfHostError(setup.error);
		expect(text).toContain("telemetry.crash_reports");
		expect(text).toContain("self-hosted");
	});

	test("telemetry explicitly off is fine", async () => {
		writePolicy(
			JSON.stringify({
				telemetry: {
					crash_reports: false,
					usage: false,
					outcome_sharing: false,
				},
			}),
		);
		const setup = await checkSelfHost(systemFs, home);
		expect(setup.ok).toBe(true);
	});

	test("a models path that is a file, not a directory, refuses to start", async () => {
		mkdirSync(join(home, ".maina"), { recursive: true });
		writeFileSync(modelDir(), "not a directory");
		const setup = await checkSelfHost(systemFs, home);
		expect(setup.ok).toBe(false);
		if (setup.ok) return;
		expect(setup.error.kind).toBe("model");
		expect(describeSelfHostError(setup.error)).toContain(modelDir());
	});
});

describe("describeSelfHost", () => {
	test("names the policy file and the model artifacts on one line", () => {
		expect(
			describeSelfHost({
				policy: { file: "/home/bun/.maina/policy.json", state: "valid" },
				model: {
					dir: "/home/bun/.maina/models",
					files: ["system1.onnx"],
				},
			}),
		).toBe(
			"policy /home/bun/.maina/policy.json (valid); model /home/bun/.maina/models (1 file: system1.onnx)",
		);
	});

	test("says when the defaults apply and no model is installed", () => {
		expect(
			describeSelfHost({
				policy: { file: "/h/.maina/policy.json", state: "absent" },
				model: { dir: "/h/.maina/models", files: [] },
			}),
		).toBe(
			"policy /h/.maina/policy.json (absent: built-in defaults); model /h/.maina/models (none installed: heuristics serve every decision)",
		);
	});
});
