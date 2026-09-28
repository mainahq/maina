---
"@mainahq/cli": minor
"@mainahq/core": minor
---

Managed policy from Maina Cloud. On an enrolled device the resident runtime now pulls the org's policy bundle every minute from `GET /link/v1/policy`. Each pull sends the ETag of the bundle the device holds in `If-None-Match`, so an unchanged bundle comes back as a 304. The runtime applies a bundle only when all of these hold:

- it matches the published schema
- it names the device's org
- the org's pinned policy-bundle key signed it
- it is valid now
- it is not older than the bundle already held
- its policy body validates

Anything else is refused: a tampered or unsigned bundle, one signed by an unknown key, a downgrade, another org's bundle, or one that isn't valid yet. The last good bundle stays in force and also applies offline. It is kept owner-only in the Link directory, at `policy/bundle.json`. The gate reads it from disk only and verifies it again whenever the file changes, so a cloud outage adds no gate latency. A held bundle that has been edited on disk makes the gate ask.

The cloud's production signer is dark for now. While it is, the cloud marks bundles unsigned (`keyId: "unsigned"`, an all-zero signature). No pinned key verifies such a bundle, so the runtime refuses it as `unsigned` and keeps its last good bundle (cloud adr/0012 §6).

Core adds the managed layer, so policy now merges in the order defaults < managed < user < repo (`loadPolicy`'s new optional `managed` argument, `parseManagedLayer`, `activeBudgetDirectives`). On an enrolled machine the managed layer is a floor. A user or repo layer may tighten any action class or run budget the managed layer sets, but never loosen it, and no allow rule turns a class the managed layer holds at `ask` into an allow. A loosening doesn't fail the load: the managed value wins, and the attempt is recorded in `Policy.managed.overridden`. A machine that was never enrolled gets exactly the policy it got before this change.

The bundle's run budgets bound `maina run`. A `stop` budget directive, meaning an org or team budget was reached for the current day, week or month, makes `maina run` refuse to start. `maina doctor` reports:

- the managed policy's version and signature state
- the last refused bundle (an unsigned one included)
- the budget directives in force
- every user or repo setting the managed layer overrides

`maina cloud status` shows the managed policy line. `degrade` directives and the bundle's exceptions are not applied yet.
