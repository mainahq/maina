# 0050. ONNX runtime and tokenizer packaging for System 1

Date: 2026-09-27

## Status

Accepted

## Context

The `system1` backend (mainahq/maina#338) runs a small ONNX encoder on the user's machine. maina-model's handoff (`docs/handoff/system1-artifact.md`) fixes what a model release contains: the graph, `tokenizer.json`, and per target the onnxruntime-node addon and its shared library (`ort/<target>/`), plus onnxruntime-web's WASM engine (`wasm/ort-wasm-simd-threaded.wasm`). All of these are signed, and `packages/runtime/src/model/verify.ts` (#575) checks them. The runtime must load the engine and the tokenizer inside the standalone executable that ADR 0045 builds with `bun build --compile`.

The review of the model stack (mainahq/maina-model#13, filed here as #587) found four open points:

1. **`bun build --compile` takes no plugins.** onnxruntime-node loads its addon with `require(\`../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node\`)`, relative to its own package. Bundled into a compiled executable, that path points into Bun's virtual `$bunfs`, where no addon exists. A build plugin could rewrite that module, but only through the `Bun.build` JS API. The alternative is to keep onnxruntime-node out of the bundle and load the verified addon ourselves.
2. **Which packages.** Use onnxruntime-web (at least 1.30.0, the release's `minRuntime`) and `@huggingface/tokenizers`, not `@huggingface/transformers`.
3. **windows-arm64.** maina-model's release targets list it, but the runtime did not build it. The Windows launcher already maps an Arm64 machine to `windows-arm64`, so those users got no runtime at all.
4. **darwin-x64 and musl.** onnxruntime-node ships no prebuilt addon for these targets, so only the WASM engine can run there. That engine is too slow for the gate's budget, so these targets run System 1 in shadow only, and users need a notice that says so.

## Decision

### Native engine: onnxruntime-common plus a `process.dlopen` shim

We keep `bun build --compile` and add no plugin. onnxruntime-node is not a dependency, and no part of it goes into the executable.

- `packages/runtime/src/model/engine.ts` loads `<release>/ort/<target>/onnxruntime_binding.node` by absolute path with `process.dlopen`, and only after `verify.ts` has checked it. It calls the addon's `initOrtOnce` with onnxruntime-common's `Tensor`, then registers a small shim as onnxruntime-common's `cpu` backend. The shim is a port of onnxruntime-node's `lib/backend.ts` over the loaded addon, so sessions use onnxruntime-common's `InferenceSession` API, with 4 intra-op threads by default.
- The addon finds `libonnxruntime` next to itself (`@loader_path` on macOS, `$ORIGIN` on Linux), so the release directory is self-contained.
- A process loads one addon and never unloads it. A second, different directory is refused with `engine_load_failed`.
- Every failure is a `Result` (`engine_load_failed`, `session_failed`, `run_failed`), never a throw. The loader (#338) turns it into the session's disabled notice (system1-artifact.md §8).

We rejected `Bun.build` with a plugin. The plugin would depend on onnxruntime-node's private file layout (`dist/binding.js`) and break whenever that layout changes. It would also need the 300 MB onnxruntime-node package, with every platform's binaries, in `node_modules` just to bundle about 10 KB of JS. Shipping the addon inside the executable would add 45 MB per target and duplicate the copy the model release already ships. With the shim, the release's own signed addon is the only native code the runtime loads.

### WASM engine: onnxruntime-web's self-contained bundle

`onnxruntime-web/wasm` resolves to `ort.wasm.bundle.min.mjs`, which embeds its JS glue. Bun bundles it into the executable (about 73 KB) with no plugin. The 14 MB `.wasm` is not embedded: it comes from the verified release as bytes (`env.wasm.wasmBinary`). The engine runs single-threaded with no proxy worker.

### One pinned onnxruntime version

`onnxruntime-web` and `onnxruntime-common` are pinned exactly to `ORT_VERSION` (1.30.0) in `packages/runtime/package.json`, and a test holds them to it. The release's `.wasm` must come from the same onnxruntime-web build as the JS glue bundled into the runtime, and the addon's init takes onnxruntime-common's `Tensor`. A model release therefore ships the onnxruntime-node and onnxruntime-web files of exactly this version, which must be at least the manifest's `runtime.minRuntime`. A mismatch fails to load and disables the model for the session, with a notice. It never fails closed.

### Tokenizer: `@huggingface/tokenizers`

`packages/runtime/src/model/tokenizer.ts` wraps `@huggingface/tokenizers` 0.2.0 (pure JS, about 360 KB, no dependencies) over the release's `tokenizer.json`, and encodes with `add_special_tokens: false`. We rejected `@huggingface/transformers` because it brings its own onnxruntime and model hub client.

### Targets: windows-arm64 is native; darwin-x64 and musl are WASM, shadow only

`engineSupport(target)` in `engine.ts` is the single table:

| target | engine | System 1 |
| --- | --- | --- |
| `darwin-arm64`, `linux-x64`, `linux-arm64`, `windows-x64`, `windows-arm64` | native (onnxruntime-node addon) | decides when promoted |
| `darwin-x64`, `linux-x64-musl`, `linux-arm64-musl` | WASM (onnxruntime-web) | shadow only |

- **windows-arm64 becomes a runtime target** (`TARGETS` in `build/standalone.ts`), compiled with `bun-windows-arm64` and smoke-tested on a `windows-11-arm` runner. onnxruntime-node ships a native win32/arm64 addon, so this target runs natively. We rejected dropping it from the model targets: that would leave Arm64 Windows machines, where the launcher already asks for `windows-arm64`, with no runtime. We also rejected mapping them to the x64 build under emulation, which would be slower for no gain.
- **darwin-x64 and musl** run the WASM engine in shadow only. When the model loads there, the runtime shows the target's notice: `system1: onnxruntime has no native build for <target>, so the model runs on the slower WASM engine in shadow only; the rules keep deciding`. The System 1 docs page lists the same table. If a future bench shows the WASM engine within budget on a target, that target can drop the shadow-only flag.

### Proof inside the compiled executable

The standalone executable gains a `model-selftest <dir> --target <target> [--engine native|wasm]` mode (`src/model/selftest.ts`). It loads the tokenizer and an engine from a directory laid out like a model release, tokenizes a fixed probe text, runs the model once and prints a JSON report. The mode verifies no signature, so it is a packaging check only and never reads a directory the runtime trusts.

The runtime-artifacts workflow stages a tiny ONNX model (one `Mul` node, written byte by byte in `src/model/__tests__/fixtures/tiny-model.ts`), a WordPiece tokenizer and onnxruntime-web's `.wasm`. On a native target it adds the onnxruntime-node addon from npm at `ORT_VERSION`. It then runs the compiled executable's `model-selftest` on each target it can run:

- the WASM and native engines on linux-x64, linux-arm64, darwin-arm64, windows-x64 and windows-arm64;
- the WASM engine on musl, in Alpine;
- the WASM engine on darwin-x64, under Rosetta when the runner has it.

The same job runs the engine unit tests with the native addon staged.

## Consequences

### Positive

- The runtime executable stays one `bun build --compile` file with no build plugin. It grows by the onnxruntime-web and tokenizer JS only, and no native model code ships inside it.
- The only native code System 1 loads is the addon in the signed model release, loaded by absolute path after verification.
- Arm64 Windows gets a native runtime, where before the launcher found no artifact.

### Negative

- The shim mirrors onnxruntime-node's `lib/backend.ts` and depends on the addon's exports (`InferenceSession`, `initOrtOnce`). An onnxruntime upgrade must re-check the shim, and the CI self-test is what catches a break.
- `onnxruntime-web` adds about 145 MB unpacked to `node_modules` (all its WASM variants), though the executable embeds only the 73 KB bundle.
- The model release and the runtime must move to a new onnxruntime version together.
- darwin-x64 and musl users never get System 1 decisions, only shadow records, until the WASM engine meets the budget there.
- `windows-arm64` adds a build and a runner to the release and to CI.
