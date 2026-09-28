/**
 * The release workflow's signing-key check (mainahq/maina#424): a manual
 * dispatch with `key_check: true` proves the `MAINA_RUNTIME_SIGNING_KEY`
 * secret is the key the launcher pins, by the release preflight and one
 * artifact built and signed with the secret, and publishes nothing.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Step = Readonly<{
	name?: string;
	run?: string;
	uses?: string;
	env?: Readonly<Record<string, string>>;
}>;
type Job = Readonly<{
	if?: string;
	permissions?: Readonly<Record<string, string>>;
	steps: readonly Step[];
}>;
type Workflow = Readonly<{
	on: Readonly<{
		workflow_dispatch?: Readonly<{
			inputs?: Readonly<
				Record<string, Readonly<{ type?: string; default?: unknown }>>
			>;
		}>;
	}>;
	jobs: Readonly<Record<string, Job>>;
}>;

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const workflow = Bun.YAML.parse(
	readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf-8"),
) as Workflow;

const job = (name: string): Job => {
	const found = workflow.jobs[name];
	if (found === undefined) throw new Error(`release.yml has no ${name} job`);
	return found;
};

const scriptOf = (j: Job): string =>
	j.steps.map((s) => `${s.run ?? ""}\n${s.uses ?? ""}`).join("\n");

describe("release.yml signing-key check", () => {
	test("a manual dispatch takes a key_check input, off by default", () => {
		expect(workflow.on.workflow_dispatch?.inputs?.key_check).toMatchObject({
			type: "boolean",
			default: false,
		});
	});

	test("the key-check job runs only on a dispatch that asks for it", () => {
		const condition = job("key-check").if ?? "";
		expect(condition).toContain("github.event_name == 'workflow_dispatch'");
		expect(condition).toContain("inputs.key_check");
	});

	test("the lockstep dry run does not also run on a key check", () => {
		expect(job("dry-run").if ?? "").toContain("!inputs.key_check");
	});

	test("the key-check job reads the secret and can write nothing", () => {
		const j = job("key-check");
		expect(j.permissions).toEqual({ contents: "read" });
		const env = j.steps.flatMap((s) => Object.values(s.env ?? {}));
		expect(env).toContain(`\${{ secrets.MAINA_RUNTIME_SIGNING_KEY }}`);
	});

	test("it builds and signs one artifact, then checks it against the pin", () => {
		const script = scriptOf(job("key-check"));
		expect(script).toMatch(
			/packages\/runtime\/build\/standalone\.ts [^\n]*--targets linux-x64 [^\n]*--signing-key/,
		);
		expect(script).toContain("scripts/release/key-check.ts");
		expect(script).toContain("--launcher packages/runtime/launcher");
		// The launcher's own check: openssl against the committed key.
		expect(script).toContain(
			"openssl dgst -sha256 -verify packages/runtime/launcher/release.pub.pem",
		);
	});

	test("it removes the key file it writes", () => {
		const script = scriptOf(job("key-check"));
		expect(script).toContain("printf '%s\\n' \"$MAINA_RUNTIME_SIGNING_KEY\" >");
		expect(script).toContain('rm -f "$key"');
	});

	test("it publishes nothing", () => {
		const script = scriptOf(job("key-check"));
		for (const forbidden of [
			"publish-artifacts",
			"changesets/action",
			"gh release",
			"gh pr create",
			"npm publish",
			"bun run release",
			"git push",
			"upload-artifact",
		]) {
			expect(script).not.toContain(forbidden);
		}
	});
});
