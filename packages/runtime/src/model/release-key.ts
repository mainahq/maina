/**
 * The model release key pinned in the runtime (#574, #424).
 *
 * Model releases are signed with the release key, the key that signs the
 * runtime executables, so the runtime pins the same public half the
 * launchers do: `launcher/release.pub.pem`. It is imported as text, so
 * `bun build --compile` bundles it into the executable. Nothing here reads
 * the environment or the disk, so neither can replace it.
 *
 * The signature check is built from a key (`releaseSignatureCheck`): the
 * runtime builds it over `RELEASE_PUBLIC_KEY`, tests over a dev key.
 */

import { verifySignature } from "../../build/standalone";
import pem from "../../launcher/release.pub.pem" with { type: "text" };
import type { SignatureCheck } from "./verify";

/** The public half of the release key, SPKI PEM. */
export const RELEASE_PUBLIC_KEY: string = pem;

/** RSA-SHA256 (PKCS#1 v1.5) against `publicKeyPem`. Never throws. */
export const releaseSignatureCheck =
	(publicKeyPem: string): SignatureCheck =>
	(bytes, signature) =>
		verifySignature(bytes, signature, publicKeyPem);
