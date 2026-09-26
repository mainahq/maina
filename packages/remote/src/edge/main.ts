/**
 * The edge forwarders of a self-hosted install, run from the same image
 * as the service (the compose file and the helm chart start them by path):
 *
 *   bun packages/remote/src/edge/main.ts egress
 *     PORT (3128), MAINA_EGRESS_ALLOW (default: GitHub). Logs one JSON line
 *     per attempt to leave on stdout.
 *
 *   bun packages/remote/src/edge/main.ts ingress
 *     PORT (8787), MAINA_INGRESS_UPSTREAM (default http://remote:8787).
 *
 * Both shut down cleanly on SIGINT / SIGTERM.
 */

import { parseAllowlist, startEgressProxy } from "./egress";
import { ingressHandler } from "./ingress";

const fail = (message: string): never => {
	process.stderr.write(`maina edge: ${message}\n`);
	process.exit(1);
};

function portFrom(raw: string | undefined, fallback: number): number {
	const value = raw?.trim() || String(fallback);
	const port = Number(value);
	return /^\d+$/.test(value) && port >= 1 && port <= 65_535
		? port
		: fail("PORT must be a port number (1-65535)");
}

async function egress(): Promise<() => Promise<void>> {
	const allow = parseAllowlist(process.env.MAINA_EGRESS_ALLOW);
	if (!allow.ok) return fail(`MAINA_EGRESS_ALLOW: ${allow.error.message}`);
	const proxy = await startEgressProxy({
		port: portFrom(process.env.PORT, 3128),
		allow: allow.value,
		log: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
	});
	process.stderr.write(
		`maina edge: egress proxy on port ${proxy.port}, allowing ${allow.value
			.map((d) => `${d.host}:${d.port}`)
			.join(", ")}\n`,
	);
	return proxy.stop;
}

async function ingress(): Promise<() => Promise<void>> {
	const upstream =
		process.env.MAINA_INGRESS_UPSTREAM?.trim() || "http://remote:8787";
	if (!URL.canParse(upstream)) {
		return fail("MAINA_INGRESS_UPSTREAM must be a URL");
	}
	const forward = ingressHandler(upstream);
	const server = Bun.serve({
		port: portFrom(process.env.PORT, 8787),
		// The caller's address travels on in X-Forwarded-For.
		fetch: (req, bun) => forward(req, bun.requestIP(req)?.address),
		// SSE streams stay open; the service decides when they end.
		idleTimeout: 0,
	});
	process.stderr.write(
		`maina edge: ingress on port ${server.port}, forwarding to ${upstream}\n`,
	);
	return () => server.stop(true);
}

const role = process.argv[2];
const stop =
	role === "egress"
		? await egress()
		: role === "ingress"
			? await ingress()
			: fail(
					`unknown role ${JSON.stringify(role ?? "")}; expected egress or ingress`,
				);

const shutdown = async (): Promise<void> => {
	await stop();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
