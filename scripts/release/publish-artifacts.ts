#!/usr/bin/env bun
/**
 * Publish a lockstep release (v1 task 9.7, FR-INS-2). One GitHub release,
 * `runtime-v<version>` (the tag the launcher manifest's URLs name), carries
 * every artifact with its `.sig`, `release.json` and the signed runtime
 * manifest. The marketplace bumps are not assets: they reach the
 * marketplaces as a pull request (`bump-marketplaces.ts`). With `--npm` it also publishes the CLI tarballs; the release
 * workflow leaves that to `changeset publish`, which publishes the same
 * versions.
 *
 *   bun scripts/release/publish-artifacts.ts --dir dist/release \
 *     --public-key pub.pem [--dry-run] [--npm]
 *
 * Nothing is published unless the release passes the lockstep check, and a
 * dry-run release (signed with a throwaway key) is never published: with
 * `--dry-run` the script prints the commands it would run and stops.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import {
	checkRelease,
	describeProblems,
	type Release,
	type ReleaseProblem,
} from "./lockstep";
import { RUNTIME_MANIFEST, readFrom, verifyReleaseDir } from "./sign";

type Result<T, E> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: E }>;

export type PublishOptions = Readonly<{ dryRun: boolean; npm: boolean }>;

export type PublishPlan = Readonly<{
	tag: string;
	/** Paths from the release directory, uploaded as release assets. */
	assets: readonly string[];
	/** The commands to run from the release directory, in order. */
	commands: readonly (readonly string[])[];
}>;

export type PublishError = Readonly<
	| { kind: "dry_run_release" }
	| { kind: "check_failed"; problems: readonly ReleaseProblem[] }
	| { kind: "duplicate_asset"; name: string }
>;

export function describePublishError(error: PublishError): string {
	switch (error.kind) {
		case "dry_run_release":
			return "this release was built by a dry run and signed with a throwaway key: it is never published";
		case "check_failed":
			return `the release is incomplete:\n  ${describeProblems(error.problems).join("\n  ")}`;
		case "duplicate_asset":
			return `two release assets are named ${error.name}`;
		default: {
			const never: never = error;
			return String(never);
		}
	}
}

/**
 * The commands that publish `release`, or why it must not be published: a
 * dry-run release published for real, or one that fails the lockstep check.
 */
export function preparePublish(
	release: Release,
	read: (file: string) => Uint8Array | undefined,
	publicKeyPem: string,
	options: PublishOptions,
): Result<PublishPlan, PublishError> {
	if (release.dryRun && !options.dryRun) {
		return { ok: false, error: { kind: "dry_run_release" } };
	}
	const checked = checkRelease(release, read, publicKeyPem);
	if (!checked.ok) {
		return {
			ok: false,
			error: { kind: "check_failed", problems: checked.error },
		};
	}
	const assets = [
		...release.artifacts
			.filter((a) => a.kind !== "marketplace")
			.flatMap((a) => [a.file, `${a.file}.sig`]),
		"release.json",
		"release.json.sig",
		RUNTIME_MANIFEST,
		`${RUNTIME_MANIFEST}.sig`,
	];
	const seen = new Set<string>();
	for (const asset of assets) {
		const name = basename(asset);
		if (seen.has(name))
			return { ok: false, error: { kind: "duplicate_asset", name } };
		seen.add(name);
	}
	const tag = `runtime-v${release.version}`;
	const gh = [
		"gh",
		"release",
		"create",
		tag,
		...assets,
		"--title",
		`maina ${release.version}`,
		"--notes",
		`maina ${release.version}: the CLI packages, the standalone runtime for every OS/arch and the host plugins, released together. Each asset has a detached RSA-SHA256 signature (.sig) by the release key the launcher pins (ADR 0045); release.json lists every artifact with its sha256.`,
		...(release.version.includes("-") ? ["--prerelease"] : []),
	];
	const npm = options.npm
		? release.artifacts
				.filter((a) => a.kind === "npm")
				.map((a) => [
					"npm",
					"publish",
					a.file,
					"--access",
					"public",
					"--provenance",
				])
		: [];
	return { ok: true, value: { tag, assets, commands: [...npm, gh] } };
}

async function main(argv: readonly string[]): Promise<number> {
	let values: Record<string, string | boolean | undefined>;
	try {
		values = parseArgs({
			args: [...argv],
			strict: true,
			options: {
				dir: { type: "string" },
				"public-key": { type: "string" },
				"dry-run": { type: "boolean" },
				npm: { type: "boolean" },
			},
		}).values;
	} catch (err) {
		process.stderr.write(`publish-artifacts: ${String(err)}\n`);
		return 2;
	}
	const { dir, "public-key": keyPath } = values;
	if (typeof dir !== "string" || typeof keyPath !== "string") {
		process.stderr.write(
			"publish-artifacts: --dir and --public-key are required\n",
		);
		return 2;
	}
	let key: string;
	try {
		key = readFileSync(keyPath, "utf-8");
	} catch (err) {
		process.stderr.write(
			`publish-artifacts: cannot read ${keyPath}: ${String(err)}\n`,
		);
		return 2;
	}
	const verified = verifyReleaseDir(dir, key);
	if (!verified.ok) {
		process.stderr.write(
			`publish-artifacts: the release in ${dir} is incomplete:\n  ${verified.error.join("\n  ")}\n`,
		);
		return 1;
	}
	const dryRun = values["dry-run"] === true;
	const plan = preparePublish(verified.value, readFrom(dir), key, {
		dryRun,
		npm: values.npm === true,
	});
	if (!plan.ok) {
		process.stderr.write(
			`publish-artifacts: ${describePublishError(plan.error)}\n`,
		);
		return 1;
	}
	for (const cmd of plan.value.commands) {
		process.stderr.write(
			`publish-artifacts: ${dryRun ? "would run" : "running"}: ${cmd.slice(0, 4).join(" ")} … (${cmd.length - 4} more args)\n`,
		);
		if (dryRun) continue;
		const proc = Bun.spawn([...cmd], {
			cwd: dir,
			stdin: "ignore",
			stdout: "inherit",
			stderr: "inherit",
		});
		const code = await proc.exited;
		if (code !== 0) {
			process.stderr.write(`publish-artifacts: ${cmd[0]} exited ${code}\n`);
			return 1;
		}
	}
	process.stderr.write(
		`publish-artifacts: ${dryRun ? "dry run: would publish" : "published"} ${plan.value.tag} with ${plan.value.assets.length} assets\n`,
	);
	return 0;
}

if (import.meta.main) {
	process.exit(await main(process.argv.slice(2)));
}
