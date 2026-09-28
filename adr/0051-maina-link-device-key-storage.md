# 0051. Maina Link device key storage and protocol vendoring

Date: 2026-09-28

## Status

Accepted

## Context

Task 4.4 of the cloud control plane (mainahq/maina#589, spec §6.3 "Enrol",
FR-ID-6, FR-PRIV-3) enrols a machine with Maina Cloud. The device
generates an Ed25519 key pair locally, proves possession to the cloud, and
buys short-lived access tokens by signing challenges with that key. The
plan leaves one choice to the harness: where the private key lives
("keychain or file"). Two related choices come with it: where the Link
client code sits so the CLI's Node build can run it, and how the runtime
holds the protocol the cloud defines.

Constraints:

- The private key must never be logged, sent, or written with group or
  world permissions. No plaintext bearer token may be stored.
- `maina cloud` must run under the Node build of the CLI (v1 constraint)
  and under the Bun standalone runtime. CI runners (`maina cloud enrol
  --ci`) usually have no keychain and no desktop session.
- The cloud defines every Link wire shape (its Global Constraint 8) and
  publishes each version with a manifest of sha256 hashes (cloud adr/0009).

## Decision

### The key is an owner-only file

The key is a PKCS#8 PEM file at `~/.maina/link/device.key`. The directory
is created `0700` and every file in it `0600`, and `MAINA_LINK_DIR`
overrides the location. The enrolment (device and org ids, pinned org
keys, link salt, endpoints, revocation mark) sits beside it in
`device.json`, also `0600`. `packages/runtime/src/link/store.ts` owns
both files:

- Each write goes to a fresh owner-only temp file and is renamed into
  place, so a crash never leaves half a key. An existing file with looser
  permissions is replaced, not reused.
- A key file that group or others can read is refused on read, as ssh
  refuses such a key.
- Access tokens are never written. They live in memory for their 15
  minutes and are bought again by signing a new challenge.

On Windows, POSIX modes do not apply. The files inherit the user
profile's ACL, which is owner-only by default.

We did not choose the OS keychain (macOS Keychain, libsecret, Windows
Credential Manager). Each one needs a native module or a helper process
per OS, none of them works the same under Node and Bun, and CI runners
and headless Linux have no keychain at all. So a file backend would be
needed anyway. The store is a port (`LinkStore`), so a keychain backend
can be added behind it later without changing the protocol or the
commands.

### The Link client sits in the runtime, and the CLI imports it

The client lives in `packages/runtime/src/link/*`, as the plan asks. Its
modules import only `node:` builtins, `@mainahq/core`, `ajv` and each
other, and they use no Bun API; a static test in `pin.test.ts` enforces
this. The CLI depends on `@mainahq/runtime` as a workspace dev dependency
and bundles these modules into its Node build, as it already does for the
harness. `packages/cli/src/commands/cloud.ts` parses arguments and
formats output. A test bundles the command with `target: "node"` and runs
enrol, status, privacy and logout under a real `node` binary against a
fake cloud served over HTTP.

### The protocol is vendored with a sha256 pin

The cloud's `protocol/link/v1/` is copied byte for byte into
`packages/runtime/src/link/protocol/v1/`, and `protocol/pin.ts` pins the
sha256 of its `manifest.json`:

- `scripts/link/sync-protocol.ts --pin <sha256>` fetches a published
  version from `GET /link/v1/schemas/<path>`. It checks the manifest
  against the pin and every file against the manifest, and only then
  replaces the directory and the pin.
- `pin.test.ts` fails when any vendored file drifts from the manifest, and
  when a wire type is declared anywhere except `link/protocol`.
- The client validates each message it sends and each answer it reads
  against the vendored JSON Schemas, so the schemas remain the one source
  of truth.
- `.gitattributes` marks the directory `-text`, so a Windows checkout
  keeps the exact bytes.

## Consequences

- Anyone who can read the user's files can take the device key, which is
  the same exposure as an ssh key. An admin revokes a lost device in the
  cloud, and revocation takes effect on the device's next Link call
  (`device_revoked` stops Link locally too).
- `maina cloud logout` deletes only the local files. The org keeps listing
  the device until an admin revokes it, and the command says so.
- The cloud does not yet tell a device its org's data class, and the
  refusal codes the runtime acts on (adr/0010 in the cloud repo) are not
  in the published protocol files. Until they are, `maina cloud privacy`
  defaults to `metadata`, and the codes are named once in
  `link/protocol/wire.ts`.
- The workspace now has a dependency cycle: the runtime depends on the CLI
  (it embeds the CLI in the standalone binary), and the CLI dev-depends on
  the runtime for the Link modules. Bun resolves the cycle, and the CLI's
  published package lists no runtime dependency, because the modules are
  bundled into it.
