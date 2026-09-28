---
"@mainahq/cli": minor
---

Maina Link event uplink. On an enrolled device the resident runtime queues Link events in an outbox, `~/.maina/link/outbox.log` (or `MAINA_LINK_DIR`), and sends them to the org's cloud in the background, away from the gate path:

- Each event gets an `eventId`, which the cloud dedupes on, and the device's next sequence number. The sequence doesn't depend on the clock, so clock skew can't reorder or repeat events. The cloud finds a lost event as a gap in the sequence.
- The outbox is encrypted at rest (AES-256-GCM) with a key derived from the device key, so nothing can read it without that key. `maina cloud logout` deletes it along with the key.
- The outbox is bounded by count, size and age. At the limit, `run.step` progress events are dropped first. Every drop writes a gap marker that records its sequence numbers, reason and event types, so nothing is lost without a record.
- Events go out in signed batches with size limits. While the cloud can't be reached, delivery backs off exponentially, up to 5 minutes. When the connection comes back, the backlog is replayed in order. The runtime follows the cloud's `nextExpectedSeq` and resends any gap the cloud reports.
- Nothing is queued or sent unless the device is enrolled and not revoked. By default only metadata is sent: an event above the org's data class is refused. Repo and branch identifiers are keyed with the org link salt from enrolment.

With the uplink busy, the gate bench stays far inside its 50 ms p95 budget (`bun run --cwd packages/runtime bench:uplink`).
