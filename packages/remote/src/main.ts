/**
 * The remote connector process: reads its configuration from the
 * environment (`readRemoteConfig`), serves the maina MCP tools for one
 * workspace over Streamable HTTP behind OAuth 2.1, with an owner (and any
 * further users) who approve clients on a consent page after HTTP Basic
 * sign-in, and shuts down cleanly on SIGINT / SIGTERM. The Dockerfile runs
 * this file.
 *
 * Before serving it checks the operator's policy file and model directory
 * under `$HOME/.maina` (`checkSelfHost`) and refuses to start on a broken
 * or telemetry-enabling policy.
 */

import { homedir } from "node:os";
import { systemFs } from "@mainahq/core";
import { systemRuntime } from "@mainahq/mcp";
import { basicAuthenticator } from "./auth";
import {
	checkSelfHost,
	describeSelfHost,
	describeSelfHostError,
} from "./selfhost";
import { createRemoteService, readRemoteConfig } from "./server";

const config = readRemoteConfig(process.env, process.cwd());
if (!config.ok) {
	process.stderr.write(
		`maina remote: ${config.error.variable} ${config.error.message}\n`,
	);
	process.exit(1);
}

const home = process.env.HOME?.trim() || homedir();
const setup = await checkSelfHost(systemFs, home);
if (!setup.ok) {
	process.stderr.write(`maina remote: ${describeSelfHostError(setup.error)}\n`);
	process.exit(1);
}
process.stderr.write(`maina remote: ${describeSelfHost(setup.value)}\n`);

const {
	issuer,
	port,
	root,
	owner,
	users,
	tools,
	maxClients,
	registrationLimit,
} = config.value;
const service = createRemoteService({
	issuer,
	root,
	runtime: systemRuntime({ cwd: root, env: process.env, home }),
	authenticate: basicAuthenticator([owner, ...users]),
	maxClients,
	registrationLimit,
	...(tools !== undefined ? { tools } : {}),
});

const server = Bun.serve({
	port,
	// The connection's address keys the client registration rate limit.
	// Behind a proxy (the compose ingress) every caller shares the proxy's.
	fetch: (req, bun) =>
		service.fetch(req, { address: bun.requestIP(req)?.address }),
	// Streamable HTTP keeps SSE responses open; the session idle timeout,
	// not the socket's, decides when a quiet client is dropped.
	idleTimeout: 0,
});

process.stderr.write(
	`maina remote: serving ${service.tools.join(", ")} for ${root} at ${issuer}/mcp (port ${server.port})\n`,
);

async function shutdown(): Promise<void> {
	await service.close();
	await server.stop(true);
	process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
