---
"@mainahq/core": patch
---

Overlapping code-graph syncs no longer let a stale plan overwrite newer work (FR-GRAPH-2). `indexRepo` and `updateFiles` still plan without holding a lock. Before writing, they now check that no other sync has committed since they read the store. If one has, they plan again from the newer store, trying at most three times. When every attempt loses the race they return a new `GraphStoreError` kind, `{ kind: "conflict", attempts }`, and a later sync catches up. The runtime already runs one sync at a time per root. This check also covers syncs from other processes that share the store, such as the context engine.
