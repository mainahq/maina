/** Shared fixtures for the release pipeline tests: a throwaway key pair. */

import { generateKeyPairSync } from "node:crypto";

export function testKeys(): Readonly<{
	privatePem: string;
	publicPem: string;
}> {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	return {
		privatePem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
		publicPem: publicKey.export({ type: "spki", format: "pem" }) as string,
	};
}
