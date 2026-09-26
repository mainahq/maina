/**
 * The self-host setup (FR-REM-4). The image keeps the operator's maina
 * state where a local install does: the policy file at
 * `$HOME/.maina/policy.json` (the user layer of the policy merge) and the
 * local model's artifacts in `$HOME/.maina/models`. The deployment mounts
 * both read-only.
 *
 * Both processes (the MCP service and the PR job) call `checkSelfHost`
 * before doing anything else and refuse to start when it fails, so a
 * broken policy never silently falls back to the defaults. A policy that
 * opts into telemetry is refused too: a self-hosted install talks to
 * GitHub and nothing else.
 */

import { join } from "node:path";
import {
	type FsPort,
	type PolicyError,
	parsePolicyLayer,
	type Result,
	readUserPolicy,
	userPolicyFile,
} from "@mainahq/core";

type SelfHostSetup = Readonly<{
	policy: Readonly<{ file: string; state: "valid" | "absent" }>;
	/** Artifact names in the model directory, sorted, hidden ones left out. */
	model: Readonly<{ dir: string; files: readonly string[] }>;
}>;

type SelfHostError =
	| Readonly<{
			kind: "policy";
			file: string;
			problems: readonly PolicyError[];
	  }>
	| Readonly<{ kind: "telemetry"; file: string; optIns: readonly string[] }>
	| Readonly<{ kind: "model"; dir: string; message: string }>;

/** The local model's directory under `home`. */
const modelDir = (home: string): string => join(home, ".maina", "models");

export async function checkSelfHost(
	fs: FsPort,
	home: string,
): Promise<Result<SelfHostSetup, SelfHostError>> {
	const file = userPolicyFile(home);
	const raw = await readUserPolicy({ fs }, home);
	if (!raw.ok) {
		return { ok: false, error: { kind: "policy", file, problems: raw.error } };
	}
	if (raw.value !== undefined) {
		const layer = parsePolicyLayer(raw.value, "user", file);
		if (!layer.ok) {
			return {
				ok: false,
				error: { kind: "policy", file, problems: layer.error },
			};
		}
		const optIns = Object.entries(layer.value.telemetry ?? {})
			.filter(([, on]) => on === true)
			.map(([name]) => name);
		if (optIns.length > 0) {
			return { ok: false, error: { kind: "telemetry", file, optIns } };
		}
	}

	const dir = modelDir(home);
	const listed = await fs.readDir(dir);
	if (!listed.ok) {
		// `not_found` covers a path that is there but not a directory.
		const message =
			listed.error.kind === "io"
				? listed.error.message
				: (await fs.exists(dir))
					? "not a directory"
					: undefined;
		if (message !== undefined) {
			return { ok: false, error: { kind: "model", dir, message } };
		}
	}
	return {
		ok: true,
		value: {
			policy: { file, state: raw.value === undefined ? "absent" : "valid" },
			model: {
				dir,
				// Hidden entries (a .gitkeep, say) are not artifacts.
				files: listed.ok ? listed.value.filter((f) => !f.startsWith(".")) : [],
			},
		},
	};
}

/** One line for the startup log. */
export function describeSelfHost(setup: SelfHostSetup): string {
	const policy =
		setup.policy.state === "valid"
			? `policy ${setup.policy.file} (valid)`
			: `policy ${setup.policy.file} (absent: built-in defaults)`;
	const { dir, files } = setup.model;
	const model =
		files.length === 0
			? `model ${dir} (none installed: heuristics serve every decision)`
			: `model ${dir} (${files.length} file${files.length === 1 ? "" : "s"}: ${files.join(", ")})`;
	return `${policy}; ${model}`;
}

export function describeSelfHostError(error: SelfHostError): string {
	switch (error.kind) {
		case "policy":
			return `invalid policy ${error.file}: ${error.problems
				.map((p) => `${p.path ? `${p.path}: ` : ""}${p.message}`)
				.join("; ")}`;
		case "telemetry":
			return `policy ${error.file} opts into ${error.optIns
				.map((name) => `telemetry.${name}`)
				.join(
					", ",
				)}; a self-hosted install sends nothing anywhere but GitHub, so telemetry must stay off`;
		case "model":
			return `cannot read the model directory ${error.dir}: ${error.message}`;
		default: {
			const unhandled: never = error;
			return `unknown setup error ${JSON.stringify(unhandled)}`;
		}
	}
}
