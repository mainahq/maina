/**
 * `maina model status|pull|verify` (#338): the local System 1 model.
 *
 *   maina model status [--json]   the pinned release, where it is cached,
 *                                 whether it verified and which engine runs it
 *   maina model pull              download the pinned release once, verify
 *                                 its hashes and signatures, and cache it
 *   maina model verify            verify the cached release again
 *
 * The runtime owns the model (the download, the verifier, the engines), and
 * the CLI package cannot load the runtime, so the work is a port the
 * runtime supplies, as for the status line; this module only formats.
 * `status` always exits 0; `pull` and `verify` exit 1 when the model is not
 * installed and verified, and bad arguments exit 64.
 */

import type { Result } from "@mainahq/core";

type ModelEngine = Readonly<{
	engine: "native" | "wasm";
	/** The engine cannot answer inside the gate's budget: shadow only. */
	shadowOnly: boolean;
	notice: string | undefined;
}>;

type ModelState =
	| Readonly<{ kind: "unpinned" }>
	| Readonly<{ kind: "not_installed" }>
	| Readonly<{ kind: "verified" }>
	| Readonly<{ kind: "unverified"; message: string }>;

export type ModelStatus = Readonly<{
	name: string;
	/** The pinned version; null while no release is pinned. */
	version: string | null;
	/** Where the release is (or would be) cached; null while unpinned. */
	dir: string | null;
	/** The runtime target, e.g. `darwin-arm64`. */
	target: string;
	state: ModelState;
	/** The engine this target runs the model on; absent for an unknown target. */
	engine: ModelEngine | undefined;
}>;

type ModelFailure = Readonly<{ message: string }>;

export type ModelCommandPorts = Readonly<{
	status: () => Promise<ModelStatus>;
	pull: () => Promise<
		Result<
			Readonly<{ dir: string; version: string; downloaded: boolean }>,
			ModelFailure
		>
	>;
	verify: () => Promise<
		Result<Readonly<{ dir: string; version: string }>, ModelFailure>
	>;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
}>;

const USAGE = `usage: maina model status [--json]
       maina model pull
       maina model verify
`;

function stateLine(state: ModelState): string {
	switch (state.kind) {
		case "unpinned":
			return "no release is pinned in this build";
		case "not_installed":
			return "not installed (run `maina model pull`)";
		case "verified":
			return "installed, hashes and signatures verified";
		case "unverified":
			return `refused: ${state.message}`;
		default: {
			const unreachable: never = state;
			return unreachable;
		}
	}
}

function engineLine(engine: ModelEngine | undefined, target: string): string {
	if (engine === undefined) return `none for ${target}`;
	return engine.shadowOnly
		? `${engine.engine} on ${target} (shadow only)`
		: `${engine.engine} on ${target}`;
}

function renderStatus(status: ModelStatus): string {
	const lines = [
		`${status.name} ${status.version ?? "(unpinned)"}`,
		`  state:  ${stateLine(status.state)}`,
		...(status.dir === null ? [] : [`  cache:  ${status.dir}`]),
		`  engine: ${engineLine(status.engine, status.target)}`,
		...(status.engine?.notice === undefined
			? []
			: [`  note:   ${status.engine.notice}`]),
	];
	return `${lines.join("\n")}\n`;
}

/** One `maina model <args>` invocation; resolves to the exit code. */
export async function runModel(
	args: readonly string[],
	ports: ModelCommandPorts,
): Promise<number> {
	const [command, ...rest] = args;
	if (command === "--help" || command === "-h" || command === "help") {
		ports.stdout(USAGE);
		return 0;
	}
	const json = rest.length === 1 && rest[0] === "--json";
	if (command === "status" && (rest.length === 0 || json)) {
		const status = await ports.status();
		ports.stdout(json ? `${JSON.stringify(status)}\n` : renderStatus(status));
		return 0;
	}
	if (command === "pull" && rest.length === 0) {
		const pulled = await ports.pull();
		if (!pulled.ok) {
			ports.stderr(`maina model pull: ${pulled.error.message}\n`);
			return 1;
		}
		const { version, dir, downloaded } = pulled.value;
		ports.stdout(
			downloaded
				? `system1 ${version}: downloaded and verified in ${dir}\n`
				: `system1 ${version}: already installed and verified in ${dir}\n`,
		);
		return 0;
	}
	if (command === "verify" && rest.length === 0) {
		const verified = await ports.verify();
		if (!verified.ok) {
			ports.stderr(`maina model verify: ${verified.error.message}\n`);
			return 1;
		}
		ports.stdout(
			`system1 ${verified.value.version}: verified (${verified.value.dir})\n`,
		);
		return 0;
	}
	ports.stderr(USAGE);
	return 64;
}
