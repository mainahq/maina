---
"@mainahq/core": minor
---

A repo can now protect its own branches. The policy has a new `protected_branches` list. Lists from each layer are merged on top of the defaults (`main`, `master`), and no layer can remove a branch. `evaluateGate` adds the policy's list to the gate context's own, so `git push origin <branch>` to any protected branch is `git.push.protected` (ask). A lease or delete push to one is `git.push.force`, which a policy can tighten to `deny`. The runtime now also looks up the branch checked out in each shell event's root, so a bare `git push` or `git push origin HEAD` while on a protected branch asks too. Before this change both were allowed.
