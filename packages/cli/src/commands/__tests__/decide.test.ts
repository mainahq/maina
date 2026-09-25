/**
 * `maina decide --type <t> --json` (FR-SPEC-7): answers one decision through
 * core's `decide` with the merged policy (defaults < user < repo) and prints
 * a `{ data, error, meta }` envelope whose `data.verdict` a Spec Kit workflow
 * `switch` can route on. Driven against real temp HOME and repo directories.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideAction } from "../decide";

let home: string;
let repo: string;

beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), "maina-333-home-"));
	repo = mkdtempSync(join(tmpdir(), "maina-333-repo-"));
});

afterEach(() => {
	rmSync(home, { recursive: true, force: true });
	rmSync(repo, { recursive: true, force: true });
});

function writePolicy(dir: string, policy: unknown): void {
	mkdirSync(join(dir, ".maina"), { recursive: true });
	writeFileSync(join(dir, ".maina", "policy.json"), JSON.stringify(policy));
}

function classPolicy(id: string, verdict: "allow" | "ask" | "deny"): unknown {
	return { action_classes: { [id]: { irreversible: false, verdict } } };
}

const run = (options: {
	type: string;
	input?: string;
	trusted?: string[];
	untrusted?: string[];
}) => decideAction({ cwd: repo, home, ...options });

describe("decideAction", () => {
	test("action.risk answers the class's policy verdict through the rules backend", async () => {
		const { output, exitCode } = await run({
			type: "action.risk",
			trusted: ["actionClass=git.push.force"],
		});
		expect(exitCode).toBe(0);
		expect(output.error).toBeNull();
		expect(output.meta).toEqual({ command: "decide", type: "action.risk" });
		expect(output.data?.type).toBe("action.risk");
		expect(output.data?.verdict).toBe("ask");
		expect(output.data?.confidence).toBe(1);
		expect(output.data?.decisions).toHaveLength(1);
		expect(output.data?.decisions[0]?.backend.id).toBe("rules");
	});

	test("an action class the policy does not know fails closed to ask", async () => {
		const { output, exitCode } = await run({
			type: "action.risk",
			trusted: ["actionClass=speckit.implement"],
		});
		expect(exitCode).toBe(0);
		expect(output.data?.verdict).toBe("ask");
	});

	test("the repo policy decides a custom class: allow or deny, both exit 0", async () => {
		writePolicy(repo, classPolicy("speckit.implement", "allow"));
		const allowed = await run({
			type: "action.risk",
			trusted: ["actionClass=speckit.implement"],
		});
		expect(allowed.output.data?.verdict).toBe("allow");
		expect(allowed.exitCode).toBe(0);

		writePolicy(repo, classPolicy("speckit.implement", "deny"));
		const denied = await run({
			type: "action.risk",
			trusted: ["actionClass=speckit.implement"],
		});
		expect(denied.output.data?.verdict).toBe("deny");
		expect(denied.exitCode).toBe(0);
	});

	test("the user policy under HOME applies beneath the repo policy", async () => {
		writePolicy(home, classPolicy("speckit.implement", "deny"));
		const { output } = await run({
			type: "action.risk",
			trusted: ["actionClass=speckit.implement"],
		});
		expect(output.data?.verdict).toBe("deny");
	});

	test("an invalid policy is a config error with no verdict (fail closed)", async () => {
		writePolicy(repo, { action_classes: { "Not A Class": {} } });
		const { output, exitCode } = await run({
			type: "action.risk",
			trusted: ["actionClass=deploy"],
		});
		expect(exitCode).toBe(3);
		expect(output.data).toBeNull();
		expect(output.error?.kind).toBe("policy");
	});

	test("an unknown decision type is a config error", async () => {
		const { output, exitCode } = await run({ type: "action.vibes" });
		expect(exitCode).toBe(3);
		expect(output.data).toBeNull();
		expect(output.error?.kind).toBe("unknown_type");
		expect(output.error?.message).toContain("action.risk");
	});

	test("--input supplies the state and questions; flags override its state", async () => {
		const input = JSON.stringify({
			state: { trusted: { actionClass: "deploy" }, untrusted: {} },
			questions: [
				{ kind: "choice", id: "release", options: ["allow", "ask", "deny"] },
			],
		});
		writePolicy(repo, classPolicy("speckit.release", "allow"));
		const fromInput = await run({ type: "action.risk", input });
		expect(fromInput.output.data?.decisions[0]?.id).toBe("release");
		expect(fromInput.output.data?.verdict).toBe("ask");

		const overridden = await run({
			type: "action.risk",
			input,
			trusted: ["actionClass=speckit.release"],
		});
		expect(overridden.output.data?.verdict).toBe("allow");
	});

	test("malformed --input or key=value flags are config errors", async () => {
		const badJson = await run({ type: "action.risk", input: "{nope" });
		expect(badJson.exitCode).toBe(3);
		expect(badJson.output.error?.kind).toBe("invalid_input");

		const notObject = await run({ type: "action.risk", input: "[1,2]" });
		expect(notObject.exitCode).toBe(3);
		expect(notObject.output.error?.kind).toBe("invalid_input");

		const badFlag = await run({ type: "action.risk", trusted: ["novalue"] });
		expect(badFlag.exitCode).toBe(3);
		expect(badFlag.output.error?.kind).toBe("invalid_input");
		expect(badFlag.output.error?.message).toContain("novalue");
	});

	test("a type without fixed options needs explicit questions", async () => {
		for (const type of ["spec.quality", "slop"]) {
			const { output, exitCode } = await run({ type });
			expect(exitCode).toBe(3);
			expect(output.error?.kind).toBe("invalid_input");
			expect(output.error?.message).toContain("questions");
		}
	});

	test("a bool question's verdict is its answer as a string", async () => {
		const input = JSON.stringify({
			questions: [{ kind: "bool", id: "ai-console" }],
		});
		const { output, exitCode } = await run({
			type: "slop",
			input,
			untrusted: ['text="console.log(1)"'],
		});
		expect(exitCode).toBe(0);
		expect(output.data?.verdict).toBe("true");
	});

	test("a key=value flag value is JSON when it parses, else a string", async () => {
		const input = JSON.stringify({
			questions: [{ kind: "bool", id: "ai-console" }],
		});
		// Unquoted, the value is not JSON and stays the literal string.
		const literal = await run({
			type: "slop",
			input,
			untrusted: ["text=console.log(1)"],
		});
		expect(literal.output.data?.verdict).toBe("true");
		// A JSON number is not text, so the slop rule cannot answer it.
		const numeric = await run({ type: "slop", input, untrusted: ["text=3"] });
		expect(numeric.exitCode).toBe(2);
		expect(numeric.output.error?.kind).toBe("unsupported");
	});

	test("a backend that cannot answer is a tool failure with no verdict", async () => {
		// diff.sensitive has no 1.x heuristic yet.
		const { output, exitCode } = await run({
			type: "diff.sensitive",
			input: JSON.stringify({ questions: [{ kind: "bool", id: "diff" }] }),
		});
		expect(exitCode).toBe(2);
		expect(output.data).toBeNull();
		expect(output.error?.kind).toBe("unsupported");
	});
});
