# 0030. Receipt v1 field schema

Date: 2026-04-25

## Status

Accepted

## Context

Per the 2026-04-25 direction doc, Maina's product surface is a per-PR **proof-of-correctness receipt** — hashed JSON + HTML, one URL per PR (v1 is integrity-checked via sha256; keypair signing lands in v2). The receipt is the wire format consumed by the CLI (`maina verify-receipt`), the Layer 3 GitHub App, and the Layer 4 enterprise rollup. Same shape across all three, or the format fragments before it ships.

The schema is hosted externally at `schemas.mainahq.com/v1.json` (public `mainahq/receipt-schema` repo, MIT) so third parties can adopt without a maina dependency — the moat that outlasts any GitHub-native verifier (Risk 2).

This ADR locks the field list for `v1`. Future additions get `v2`; `v1.json` is immutable once published.

## Decision

v1 receipt fields:

| Field | Type | Notes |
|---|---|---|
| `prTitle` | string | From git context |
| `repo` | string | `owner/name` |
| `timestamp` | string (ISO 8601) | Verification completion time |
| `status` | `"passed" \| "failed" \| "partial"` | Surface copy: *"passed N of M checks"* (C2) |
| `hash` | string (sha256, hex) | RFC 8785 canonicalize the receipt minus `hash` → sha256. `hash` is always excluded from the canonicalization input (never set to an empty string). |
| `diff` | `{ additions: number, deletions: number, files: number }` | Already computed in pipeline |
| `agent` | `{ id: string, modelVersion: string }` | From MCP context or git trailer. `modelVersion` is the upstream string (e.g. `claude-opus-4-7`). `id` format is `[NEEDS CLARIFICATION: slug? UUID? host-prefixed "host:agent" (e.g. "claude-code:opus")? Lock before Wave 2.]` |
| `promptVersion` | `{ constitutionHash: string, promptsHash: string }` | Already versioned. Both hashes are sha256, lowercase hex — same encoding as the top-level `hash` field. |
| `checks[]` | `Check[]` — see schema below | One per tool in the verify pipeline |
| `walkthrough` | string | 3-sentence summary, mechanical-tier model output |
| `feedback[]` | `{ checkId: string, reason: string, constitutionHash: string }[]` | False-positive reports; keyed by `constitutionHash` (sha256, lowercase hex) so feedback follows the policy, not the repo |
| `retries` | number (non-negative integer) | Default cap 3, configurable (see sibling ADR, ships in [mainahq/maina#233](https://github.com/mainahq/maina/pull/233)) |

### `Check` (v1 contract)

```ts
type CheckStatus = "passed" | "failed" | "skipped";
type CheckTool =
  | "biome" | "semgrep" | "sonar" | "trivy" | "secretlint"
  | "diff-cover" | "stryker" | "slop" | "review-spec"
  | "review-quality" | "tests" | "visual" | "doc-claims";

interface Finding {
  severity: "info" | "warning" | "error";
  file: string;      // path relative to repo root, POSIX forward slashes, no leading "./"
  line?: number;     // 1-based
  message: string;
  rule?: string;     // tool-specific rule id, e.g. "no-explicit-any"
}

interface Patch {
  diff: string;      // unified diff (git-style, with a/ b/ prefixes)
  rationale: string;
}

interface Check {
  id: string;        // synthesis rule: "${tool}-check" (e.g. "biome-check"). Stable across receipts.
  name: string;      // human label, tool-specific (e.g. "Biome lint + format")
  status: CheckStatus;
  tool: CheckTool;
  findings: Finding[];
  patch?: Patch;     // optional autofix
}
```

**Migration from `ToolProof` (packages/core/src/verify/proof.ts).** Current `ToolProof` is `{ tool, findings: number, duration, skipped }`. v1 `Check` is a superset:
- `tool` → `tool` (literal mapping)
- `findings: number` → `findings: Finding[]` (count becomes structured array; count is `findings.length`)
- `skipped: true` → `status: "skipped"`; `skipped: false` combined with `findings > 0` → `status: "failed"`; otherwise `status: "passed"`
- `duration` is dropped from the receipt surface (kept internal); if needed later, add via v2
- `id` is synthesized as `"${tool}-check"` for the first pass (deterministic); `name` is tool-specific prose from a static lookup table shipped at `packages/core/src/receipt/check-names.ts`. Wave 2 can specialize further, but this synthesis rule is the v1 contract for independent implementers.

**Excluded from v1:** no `policyName` field. Receipts enumerate checks by id; naming policies is a v2 decision once we have design-partner feedback on what granularity matters.

### Hashing

1. Build the receipt object **without** a `hash` key (or delete it if present).
2. Canonicalize the hash-less object via RFC 8785 (JSON Canonicalization Scheme).
3. `hash = sha256(canonical)` (lowercase hex).
4. Add `hash` to the object before publishing.

Verification reverses the same way: delete `hash`, canonicalize the remaining object, sha256, compare to the receipt's `hash` field. The canonicalization input must be byte-identical on both sides — the `hash` field is never part of it (never an empty string, never a placeholder).

No asymmetric crypto in v1 — integrity only, not authenticity. Keypair signing is a v2 decision tied to hosted infra.

### Versioning

Per-file immutable. `v1.json` lives forever at `schemas.mainahq.com/v1.json`. `v2.json` will live beside it. Consumers pin the URL.

## Consequences

### Positive

- Third parties can consume the schema without depending on maina or its npm package
- Receipt verification is fully offline-capable (`maina verify-receipt` pins `@mainahq/receipt-schema` as a package dep, not a hosted fetch)
- Canonical-JSON hashing means the receipt format is language-agnostic for verifiers — any RFC 8785 impl + any sha256 impl is enough
- No `policyName` in v1 keeps the schema minimal; Q2 stays open for v2 based on real usage

### Negative

- Integrity-only hashing means a bad actor could republish a maliciously-crafted receipt with a valid sha256; mitigated in v2 by keypair signing once we have hosted infra
- RFC 8785 implementations are thinner than plain JSON — v1 verifiers need a canonicalization library; mitigated by shipping one in `@mainahq/receipt-schema`
- Locking the field list at v1 means new data (spec citations, agent catalogs) must wait for v2 — accepted tradeoff for stability

## References

- Direction doc (private): `mainahq/maina-cloud:strategy/DIRECTION_AND_BUILD_PLAN_2026_04_25.md`
- Tracking issue: [mainahq/maina#226](https://github.com/mainahq/maina/issues/226)
- Retry-policy ADR (sibling): ships in [mainahq/maina#233](https://github.com/mainahq/maina/pull/233) as `adr/0031-agent-retry-recording-policy.md`
- Constitution update (sibling): tracked in [mainahq/maina#231](https://github.com/mainahq/maina/issues/231)
- `ToolProof` source: `packages/core/src/verify/proof.ts`
- RFC 8785 JSON Canonicalization Scheme: https://datatracker.ietf.org/doc/html/rfc8785
