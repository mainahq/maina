---
"@mainahq/cli": minor
"@mainahq/core": minor
---

Remote approvals in the gate. On a machine enrolled in Maina Cloud, an ask the org's managed policy routes to remote approvers is sent to the org's approvals channel as a device-signed ask. The runtime waits for the answer inside the hook, at most 1.2 s, well below every host's hook timeout. An approval signed by the org's pinned approval-resolution key allows the action and names the approver. A denial denies it and offers no local override. A bad signature, an unreachable cloud or a timeout never allows: the ask resolves to the route's deny or local prompt. While the cloud's signer is not yet live, an unsigned approval never allows: the local prompt stands in. An ask that outlasts the hook stays open and the host shows a line linking to it. A retry of the same action picks up the approver's answer. `approval.requested` and `approval.resolved` events go to the Link uplink. Until the managed policy carries approval routes, every ask stays at the local prompt.
