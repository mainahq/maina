/**
 * The one-shot GitHub App job process: reads one job from argv and the
 * App's credentials from the environment (`readJobInvocation`), runs it in
 * an ephemeral workspace under the system temp directory (or
 * `MAINA_JOBS_TMPDIR`), prints the report as JSON on stdout and exits 0,
 * or prints the error on stderr and exits 1.
 *
 *   MAINA_GITHUB_APP_ID=... MAINA_GITHUB_APP_PRIVATE_KEY="$(cat key.pem)" \
 *   bun packages/remote/src/github/main.ts verify --repo acme/widgets \
 *     --pr 7 --installation 4242
 */

import { tmpdir } from "node:os";
import { systemProcess } from "@mainahq/core";
import { systemRuntime } from "@mainahq/mcp";
import { privateKeyCredentials, restGitHubApi } from "./app";
import { systemWorkspaces } from "./checkout";
import { readJobInvocation } from "./invocation";
import { createJobRunner } from "./jobs";

const APP_SECRET = /^MAINA_GITHUB_APP_/;

const invocation = readJobInvocation(process.argv.slice(2), process.env);
if (!invocation.ok) {
	process.stderr.write(
		`maina github job: ${invocation.error.name}: ${invocation.error.message}\n`,
	);
	process.exit(1);
}

const { appId, privateKey, apiUrl, request } = invocation.value;
// The capabilities run tools over someone's pull request: the App's
// credentials never reach those child processes.
const childEnv = Object.fromEntries(
	Object.entries(process.env).filter(([name]) => !APP_SECRET.test(name)),
);
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
	runtimeFor: (root) => systemRuntime({ cwd: root, env: childEnv }),
});

const result = await run(request);
if (result.ok) {
	process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
	process.exit(0);
}
process.stderr.write(`maina github job: ${JSON.stringify(result.error)}\n`);
process.exit(1);
