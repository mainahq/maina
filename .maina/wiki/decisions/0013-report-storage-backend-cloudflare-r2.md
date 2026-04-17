# Decision: Report storage backend (Cloudflare R2)

> Status: **accepted**

## Context

Maina Cloud verification generates proof artifacts that need durable, publicly readable storage: JSON reports, HTML report views, and PNG screenshots for visual-diff checks. The system needs:

- Signed uploads from CI (no server-side proxy for large payloads)
- Public read access with CDN caching for report permalinks
- Per-run cleanup for retention and GDPR deletion
- Cost predictability at scale (10k–100k runs/month)

maina-cloud already runs on Cloudflare Workers and uses the `@workkit` monorepo for infrastructure primitives.

## Decision

Use **Cloudflare R2** as the storage backend for all verification artifacts. All R2 operations go through **`@workkit/r2`** (`@workkit/r2@0.1.1`, MIT) — the typed R2 client library that provides presigned URLs, streaming helpers, multipart upload, and error handling out of the box.

### Bucket Layout

```
maina-reports/
  r/<run-id>/
    report.json          # structured verification result
    report.html          # rendered HTML report
    shot/<id>.png        # screenshots (visual-diff before/after pairs)
    meta.json            # run metadata: commit, branch, timestamp, org_id
```

### Upload Flow (CI → R2)

1. CI calls `POST /api/runs` with run metadata
2. Server generates presigned PUT URLs via `@workkit/r2`'s `createPresignedUrl()`
3. CI uploads artifacts directly to R2 (no server proxy — zero bandwidth cost on Workers)
4. CI calls `POST /api/runs/<id>/complete` to finalize

### Read Flow (Report Viewer)

1. `GET /r/<run-id>` → server reads `report.html` via `r2.get()`, streams with `streamToBuffer()`
2. `GET /r/<run-id>.json` → server reads `report.json` via `r2.get()`, streams with `streamToJson()`
3. `GET /r/<run-id>/shot/<id>.png` → server reads PNG via `r2.get()`, serves with appropriate headers
4. Cloudflare Cache API caches responses at the edge (immutable content, cache forever)

### Retention Policy

- Default: 90 days from run creation
- Paid plans: configurable (30/90/180/365 days)
- Implementation: Cloudflare R2 lifecycle rules on `meta.json` creation date
- Alternatively: daily cron job via `@workkit/cron` listing runs older than retention window

### GDPR Delete Path

- `DELETE /api/runs/<id>` → deletes all objects under `r/<run-id>/` prefix
- `DELETE /api/org/<id>/data` → lists and deletes all runs for an org
- Uses `r2.list({ prefix })` + batch `r2.delete()` from `@workkit/r2`
- Deletion is synchronous — confirmed before response

### CDN Cache Strategy

- Report artifacts are immutable (same run-id = same content)
- Set `Cache-Control: public, max-age=31536000, immutable` on all `r/<run-id>/*` responses
- Cloudflare Cache API for edge caching (free with Workers)
- Cache purge not needed — content never changes per run-id

### Disaster Recovery

- R2 stores data across multiple Cloudflare data centers (built-in replication)
- Daily backup of `meta.json` index to a separate R2 bucket (`maina-reports-backup/`)
- Recovery: re-index from backup bucket if primary is corrupted

## Rationale

### Positive

- Zero egress fees keep costs predictable and low
- `@workkit/r2` provides typed, tested R2 operations — no custom storage code
- Presigned URLs mean CI uploads bypass the server entirely
- Cloudflare-native: no cross-cloud latency for Workers reading from R2

### Negative

- Vendor lock-in to Cloudflare (mitigated: R2 is S3-compatible, migration path exists)
- R2 lifecycle rules are less mature than S3 (mitigated: cron-based cleanup as fallback)

### Neutral

- Report viewer must be hosted on Cloudflare Workers (already the case for maina-cloud)
- S3-compatible API means existing S3 tooling works if we ever need it

## Alternatives Rejected

- Pros: Industry standard, mature tooling, lifecycle policies
- Cons: Egress fees ($0.09/GB) would dominate costs at scale. At 100k runs/mo with 5TB of reads, egress alone would be ~$450/mo vs $0 on R2.
- Verdict: Rejected — egress cost makes it 5x+ more expensive.
- Pros: Built on S3, nice dashboard, auth integration
- Cons: Extra auth layer we don't need (maina-cloud has its own), not Cloudflare-native, egress fees via AWS underneath.
- Verdict: Rejected — adds complexity without benefit for our use case.
- Pros: Zero egress, S3-compatible API, native to our Workers stack, `@workkit/r2` already provides typed client with presigned URLs
- Cons: Smaller ecosystem than S3 (mitigated by S3-compatible API)
- Verdict: **Accepted** — best cost/complexity tradeoff for our Cloudflare-native stack.
