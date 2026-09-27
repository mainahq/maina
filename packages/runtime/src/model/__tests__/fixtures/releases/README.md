Fixture model releases for `pin.test.ts`, laid out the way the `model-v*`
GitHub Releases on mainahq/maina serve them: `<baseUrl>/model-v<version>/<asset>`,
where a nested manifest path's `/` becomes `--` in the flat asset name.

Only `manifest.json` is here, because these tests check the pin, not a
release's files or signatures. The manifests have the maina-model ADR 0017
shape but are dry runs with placeholder hashes. `model-v0.1.0` stands in for a
withdrawn release and `model-v0.2.0` for the pinned one.
