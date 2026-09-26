/**
 * The one-shot GitHub App job process: reads one job from argv and the
 * App's credentials from the environment (`readJobInvocation`), runs it in
 * an ephemeral workspace under the system temp directory (or
 * `MAINA_JOBS_TMPDIR`), prints the report as JSON on stdout and exits 0,
 * or prints the error on stderr and exits 1. Before any network it checks
 * the operator's policy file and model directory under `$HOME/.maina`
 * (`checkSelfHost`); the policy is the user layer of every job's policy.
 *
 *   MAINA_GITHUB_APP_ID=... MAINA_GITHUB_APP_PRIVATE_KEY="$(cat key.pem)" \
 *   bun packages/remote/src/github/main.ts verify --repo acme/widgets \
 *     --pr 7 --installation 4242
 */

import { homedir, tmpdir } from "node:os";
import { systemFs, systemProcess } from "@mainahq/core";
import { systemRuntime } from "@mainahq/mcp";
import {
	checkSelfHost,
	describeSelfHost,
	describeSelfHostError,
} from "../selfhost";
import { privateKeyCredentials, restGitHubApi } from "./app";
import { systemWorkspaces } from "./checkout";
import { appSecretNames, readJobInvocation } from "./invocation";
import { createJobRunner } from "./jobs";

const invocation = readJobInvocation(process.argv.slice(2), process.env);
if (!invocation.ok) {
	process.stderr.write(
		`maina github job: ${invocation.error.name}: ${invocation.error.message}\n`,
	);
	process.exit(1);
}

const home = process.env.HOME?.trim() || homedir();
const setup = await checkSelfHost(systemFs, home);
if (!setup.ok) {
	process.stderr.write(
		`maina github job: ${describeSelfHostError(setup.error)}\n`,
	);
	process.exit(1);
}
process.stderr.write(`maina github job: ${describeSelfHost(setup.value)}\n`);

const { appId, privateKey, apiUrl, request } = invocation.value;
// The capabilities run tools over someone's pull request: the App's
// credentials never reach those child processes. They are dropped from
// this process's own environment, not just from a copy, because some
// runtime paths spawn with the inherited environment (`systemProcess`
// without an explicit env).
for (const name of appSecretNames(process.env)) delete process.env[name];
const childEnv = { ...process.env };
const run = createJobRunner({
	credentials: privateKeyCredentials({ appId, privateKey, now: Date.now }),
	api: restGitHubApi({
		fetch: (req) => fetch(req),
		...(apiUrl !== undefined ? { baseUrl: apiUrl } : {}),
	}),
	workspaces: systemWorkspaces({
		process: systemProcess,
		env: childEnv,
		tmpRoot: process.env.MAINA_JOBS_TMPDIR ?? tmpdir(),
	}),
	runtimeFor: (root) => systemRuntime({ cwd: root, env: childEnv, home }),
});

const result = await run(request);
if (result.ok) {
	process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
	process.exit(0);
}
process.stderr.write(`maina github job: ${JSON.stringify(result.error)}\n`);
process.exit(1);
