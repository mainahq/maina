---
"@mainahq/cli": minor
"@mainahq/core": minor
---

New `maina cloud` commands enrol this machine with Maina Cloud over Maina Link:

- `maina cloud enrol` shows a code for a member of your org to approve. The device generates its Ed25519 key on the machine and keeps it owner-only in `~/.maina/link` (or `MAINA_LINK_DIR`). The key is never logged or sent. A CI runner enrols with `maina cloud enrol --ci` and a scoped API token in `MAINA_LINK_CI_TOKEN`.
- `maina cloud status [--json] [--check]` shows the device, its org and cloud, and its pinned org keys. `--check` buys a token, so a device an admin has revoked shows as revoked straight away.
- `maina cloud logout` (or `unenrol`) forgets the device key and enrolment on this machine.
- `maina cloud privacy [--class metadata|names|rich] [--json]` prints every field Link sends at a data class, from the protocol's published `privacy.json`.

Access tokens last at most 15 minutes, are bound to the device key, and are never stored. A device that is revoked stops using Link until it enrols again. The org keys are pinned at enrolment and change only through a rotation message signed by a key the device already trusts.

Core exports `cloudBaseUrl(env)`, the `MAINA_CLOUD_URL`-or-hosted base URL that the 1.x client, `maina login` and `maina cloud` all use.
