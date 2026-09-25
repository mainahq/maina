---
"@mainahq/core": patch
---

Gate: a write or delete whose target the shell walk cannot resolve now classifies as `shell.opaque`, so the default policy asks (FR-GATE-2, FR-GATE-4). This covers a write redirect to an unresolved word (`> "$T"`, `>> $LOG`, a group's `> $OUT`), `rm`/`unlink`/`shred` with an unresolved operand (`rm "$X"`), a write command whose destination is unresolved (`tee "$T"`, `cp a "$DEST"`, `mv`/`install`/`ln` to an unresolved last operand or `-t`, `sed -i … "$F"`, `dd of=$T`), and a relative delete after a `cd` the gate cannot follow. `cd "$DIR"` now leaves the working directory unknown instead of treating it as `cd` to home. Resolved targets (`T=out.log; … > "$T"`, `/dev/null`, `2>&1`) and unresolved read redirects stay clear.
