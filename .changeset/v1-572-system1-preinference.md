---
"@mainahq/core": minor
---

The gate can now take `action.risk` answers from an async model, such as a System 1 model on onnxruntime, whose `run()` is async only. `decide` and `evaluateGate` stay synchronous. The runtime runs the model first: `gateModelInputs` lists the inputs the gate will ask, the model answers them in one pass (both orders of the two-order check), and `precomputedBackend` serves those answers to the gate. The new `GatePorts.preInferenceMs` counts the pre-inference time against the 250 ms gate budget. The gate asks when the model fails, runs past the budget or has no answer for an input.
