/**
 * Compiled by `../embedded-release-key.test.ts` with `bun build --compile`,
 * like the standalone runtime (`../../main.ts`), then run from a directory
 * with no checkout to read. Prints one JSON line: the sha256 of the release
 * key the executable carries, and whether that key accepts the given
 * signature of the given bytes.
 *
 *   release-key-probe <base64 bytes> <base64 signature>
 */

import { createHash } from "node:crypto";
import {
	RELEASE_PUBLIC_KEY,
	releaseSignatureCheck,
} from "../../../model/release-key";

const [bytes = "", signature = ""] = process.argv.slice(2);

process.stdout.write(
	`${JSON.stringify({
		sha256: createHash("sha256").update(RELEASE_PUBLIC_KEY).digest("hex"),
		verified: releaseSignatureCheck(RELEASE_PUBLIC_KEY)(
			Buffer.from(bytes, "base64"),
			signature,
		),
	})}\n`,
);
