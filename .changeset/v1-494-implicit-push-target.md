---
"@mainahq/core": minor
---

The gate now works out where a push with no refspec (`git push`, `git push <remote>`) actually goes. Before, it assumed the branch checked out. git reads the destination from config: `remote.<name>.push` refspecs, `push.default` (`upstream`/`tracking`, `current`, `simple`, `matching`, `nothing`) and `remote.<name>.mirror`. The new `readPushConfig` reads those settings through the `GitPort`, and `GateContext.push` hands them to the classifier. So a bare push from `feature` to a protected upstream, or through a `HEAD:master` refspec, is now `git.push.protected` (ask) instead of allowed. A forcing (`+`) or mirror push is `git.push.force`, as is a deleting push to a protected branch. A destination the gate cannot resolve asks. The runtime reads the push config for every shell event, and asks when it cannot read it.
