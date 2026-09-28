/**
 * The Maina Link protocol version this runtime speaks (#589, cloud
 * adr/0008 and adr/0009).
 *
 * The cloud defines every Link wire shape and publishes it at
 * `protocol/link/v1/` (and `GET /link/v1/schemas/<path>`). `./v1/` is a
 * byte-for-byte copy of one published version, and this file pins the
 * sha256 of its `manifest.json`, which lists every file with its own
 * sha256. `scripts/link/sync-protocol.ts --pin <sha256>` fetches a
 * published version, verifies it and rewrites both; the pin test fails when
 * the vendored copy drifts from this pin.
 */

/** sha256 of `./v1/manifest.json` (protocol v1). Changed only by the sync script. */
export const LINK_V1_MANIFEST_SHA256 =
	"4b2c16932bc3a063bd5736344fb10ecc194452ace651904ab5e91ccce7bb9d3d";
