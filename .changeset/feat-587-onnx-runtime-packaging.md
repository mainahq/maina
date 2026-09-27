---
"@mainahq/cli": patch
---

The standalone `maina` runtime can now load the engines the local `system1` model will run on, still as one `bun build --compile` file. onnxruntime-web and the `@huggingface/tokenizers` tokenizer are bundled into it. The native onnxruntime addon is never bundled: a signed model release ships it, and the runtime loads it by path after checking it. A new `maina model-selftest` mode runs a model from a directory once, and CI uses it to run a tiny model inside the compiled runtime on each platform. There is also a Windows on Arm (`windows-arm64`) runtime now. Before this, the Windows launcher found no runtime to download on those machines. When the model ships, it runs natively on macOS (Apple silicon), Linux (glibc) and Windows. On Intel Macs and musl Linux, onnxruntime has no native build, so the model runs on the WebAssembly engine in shadow only, and maina shows a notice saying so (ADR 0050).
