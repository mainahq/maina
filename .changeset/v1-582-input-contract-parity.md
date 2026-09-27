---
"@mainahq/core": patch
---

Core now has the TypeScript side of the System 1 input contract (encoding v1), so the future `system1` backend sends the model the same text it was trained on:

- `canonicalTexts` and `canonicaliseState` normalise a decision state the way the model does. The workspace root becomes `⟨root⟩`, home directories become `~`, the top-level `sessionId` is dropped and `classes` is sorted. Tokens such as `[CLS]` and `<|` are broken with a space. The serialiser is hand-written and sorts keys by UTF-16 code units at every depth. `JSON.stringify` puts integer-like keys (`0`..`11`) in numeric order, which the model does not.
- `lengthBucket` and `approxTokens` compute calibration length buckets with the rule in `contracts/buckets.py`. Question ids are measured at their base id, so the gate's two calls for one action always land in the same bucket.
- The parity fixtures (`decide/__fixtures__/encoding-parity.json`) hold the Python reference's own output for encoding.md examples A and B, the gate's reversed call and integer keys 0..11.
- A drift guard test pins the trusted and untrusted keys of the gate's `action.risk` request. Changing them requires a coordinated `ENCODING_VERSION` bump.

`REVERSED_SUFFIX` moved from `gate/evaluate` to `decide/encoding`.
