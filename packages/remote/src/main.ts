/**
 * The remote connector process: reads its configuration from the
 * environment (`readRemoteConfig`), serves the maina MCP tools for one
 * workspace over Streamable HTTP behind OAuth 2.1, with a single owner who
 * approves clients through HTTP Basic sign-in, and shuts down cleanly on
 * SIGINT / SIGTERM. The Dockerfile runs this file.
 */

import { systemRuntime } from "@mainahq/mcp";
import { basicAuthenticator } from "./auth";
import { createRemoteService, readRemoteConfig } from "./server";

const config = readRemoteConfig(process.env, process.cwd());
if (!config.ok) {
	process.stderr.write(
		`maina remote: ${config.error.variable} ${config.error.message}\n`,
	);
	process.exit(1);
}

const { issuer, port, root, owner, tools } = config.value;
const service = createRemoteService({
	issuer,
	root,
	runtime: systemRuntime({ cwd: root, env: process.env }),
	authenticate: basicAuthenticator(owner),
	...(tools !== undefined ? { tools } : {}),
});

const server = Bun.serve({
	port,
	fetch: service.fetch,
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
