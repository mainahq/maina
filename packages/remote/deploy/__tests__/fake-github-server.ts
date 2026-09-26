/**
 * The fake GitHub REST API (`fakeGitHub`) served over HTTP, standing in
 * for GitHub in the self-host smoke test: in-process for the process run,
 * and as the `github` service of the compose run, where it is started by
 * path with its configuration in the environment:
 *
 *   PORT                        listen port (default 80)
 *   FAKE_GITHUB_API             the origin clients use, e.g. http://api.github.test
 *   FAKE_GITHUB_PULL            the pull request, as `fakeGitHub`'s pull JSON
 *   FAKE_GITHUB_APP_PUBLIC_KEY  PEM; an App JWT must verify against it (RS256)
 *
 * `GET /__fake/state` answers what the API was asked and which tokens are
 * still live, so the test can check the job revoked its token.
 */

import { createPublicKey, createVerify } from "node:crypto";
import {
	type FakePull,
	fakeGitHub,
} from "../../src/github/__tests__/fake-github";

type ServeOptions = Readonly<{
	port: number;
	hostname?: string;
	/** The origin clients use; default `http://localhost:<port>`. */
	api?: string;
	pull: FakePull;
	appPublicKey: string;
}>;

type FakeGitHub = ReturnType<typeof fakeGitHub>;

/** Whether `jwt` is an RS256 JWT signed by the key behind `publicKey`. */
function verifiesWith(publicKey: string): (jwt: string) => boolean {
	const key = createPublicKey(publicKey);
	return (jwt) => {
		const [header, claims, signature] = jwt.split(".");
		if (header === undefined || claims === undefined || !signature) {
			return false;
		}
		return createVerify("RSA-SHA256")
			.update(`${header}.${claims}`)
			.verify(key, signature, "base64url");
	};
}

export function serveFakeGitHub(options: ServeOptions): Readonly<{
	port: number;
	api: string;
	github: Pick<FakeGitHub, "requests" | "liveTokens">;
	stop: () => void;
}> {
	let gh: FakeGitHub | undefined;
	let api = options.api ?? "";
	const server = Bun.serve({
		port: options.port,
		...(options.hostname !== undefined ? { hostname: options.hostname } : {}),
		fetch: (req) => {
			if (gh === undefined) return new Response(null, { status: 503 });
			const url = new URL(req.url);
			if (url.pathname === "/__fake/state") {
				return Response.json({
					requests: gh.requests,
					liveTokens: gh.liveTokens(),
				});
			}
			// Clients address the server by `api`; answer as that origin.
			return gh.fetch(new Request(`${api}${url.pathname}${url.search}`, req));
		},
	});
	const port = server.port ?? options.port;
	if (api === "") api = `http://localhost:${port}`;
	gh = fakeGitHub({
		api,
		pulls: [options.pull],
		acceptAppJwt: verifiesWith(options.appPublicKey),
	});
	return { port, api, github: gh, stop: () => server.stop(true) };
}

if (import.meta.main) {
	const pull = JSON.parse(process.env.FAKE_GITHUB_PULL ?? "null") as FakePull;
	const served = serveFakeGitHub({
		port: Number(process.env.PORT ?? "80"),
		api: process.env.FAKE_GITHUB_API ?? "http://api.github.test",
		pull,
		appPublicKey: (process.env.FAKE_GITHUB_APP_PUBLIC_KEY ?? "").replaceAll(
			"\\n",
			"\n",
		),
	});
	process.stdout.write(`fake github listening on ${served.port}\n`);
}
