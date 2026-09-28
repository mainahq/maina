---
"@mainahq/runtime": patch
"@mainahq/plugins": patch
---

The launchers now ship the real release public key (`release.pub.pem`, and `release.pub.xml` for PowerShell), so they install signed runtime artifacts instead of degrading with `no_release_key` (#424). The same key signs the System 1 model releases.
