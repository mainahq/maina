# UTM link pack — source-attribution playbook

Every public post that points at `mainahq.com` should use one of the links below. The landing page captures `utm_*` + `ref` on first touch into `sessionStorage`, then forwards the same payload to `/api/waitlist` (and the mailto fallback today) so we can answer the only question that matters: **what channel sent us the people who joined the beta?**

Companion: [WaitlistForm.astro](../../packages/docs/src/components/WaitlistForm.astro), [astro.config.mjs](../../packages/docs/astro.config.mjs) (UTM capture lives in the head injection).

## Convention

```
?utm_source=<channel>&utm_medium=<format>&utm_campaign=<post-or-launch>&utm_content=<variant>
```

- `utm_source` — the platform (e.g. `hn`, `x`, `lobsters`, `reddit`, `devto`, `cto-newsletter`).
- `utm_medium` — the format (e.g. `post`, `comment`, `reply`, `bio`, `dm`, `email`).
- `utm_campaign` — slug for the specific post or launch (e.g. `show-hn-may`, `context-cost-thread`).
- `utm_content` — A/B variant when we test multiple framings of the same post.

Keep slugs lowercase, hyphenated, ≤32 chars. Reuse the same `utm_campaign` across all posts that promote the same artifact so we can roll them up.

## Ready-to-paste links

### Hacker News — Show HN (launch)

```
https://mainahq.com/?utm_source=hn&utm_medium=post&utm_campaign=show-hn-launch
```

### Hacker News — top-level comment in a related thread

```
https://mainahq.com/?utm_source=hn&utm_medium=comment&utm_campaign=hn-thread-ai-codegen
```

### Twitter / X — main launch tweet

```
https://mainahq.com/?utm_source=x&utm_medium=post&utm_campaign=show-hn-launch
```

### Twitter / X — reply in a thread

```
https://mainahq.com/?utm_source=x&utm_medium=reply&utm_campaign=show-hn-launch
```

### Twitter / X — bio link

```
https://mainahq.com/?utm_source=x&utm_medium=bio&utm_campaign=evergreen
```

### Lobsters

```
https://mainahq.com/?utm_source=lobsters&utm_medium=post&utm_campaign=show-hn-launch
```

### Reddit — `/r/programming`, `/r/MachineLearning`, etc.

```
https://mainahq.com/?utm_source=reddit&utm_medium=post&utm_campaign=show-hn-launch&utm_content=r-programming
```

Swap `utm_content` per subreddit (e.g. `r-machinelearning`, `r-typescript`) so we know which subs converted.

### dev.to / Hashnode cross-posts

```
https://mainahq.com/?utm_source=devto&utm_medium=article&utm_campaign=context-cost-deep-dive
```

### Newsletter mentions (e.g. TLDR, Bytes, AI Engineer)

```
https://mainahq.com/?utm_source=tldr&utm_medium=email&utm_campaign=may-2026-feature
```

### Direct CTO outreach (1:1 DM/email)

```
https://mainahq.com/?utm_source=outreach&utm_medium=dm&utm_campaign=cto-may-batch-1
```

Substitute `utm_source=ceo-outreach` for CEO-sent links so we can separate the two pipelines in waitlist reporting.

### Talks / podcasts / conference references

```
https://mainahq.com/?utm_source=podcast&utm_medium=show-notes&utm_campaign=<show-slug>
```

## How attribution flows

```
visitor lands → utm-capture script writes maina_attrib to sessionStorage (first touch wins)
              → user navigates within the site (attribution persists across navigation)
              → user submits /cloud waitlist
                → fetch payload includes utm_* + referrer + landing_path
                  → Cloudflare Worker (mainahq/maina-cloud, MAI-12) persists row
                → mailto fallback body also embeds the attribution block
              → Plausible "Waitlist Submit" custom event fires with utm_source/medium/campaign as props
```

Pageviews + outbound clicks land in Plausible (`PUBLIC_PLAUSIBLE_DOMAIN=mainahq.com` set in Cloudflare Pages env). Waitlist submissions land in the Worker store + Plausible custom events. Cross-reference by `utm_campaign` to compute view → waitlist conversion per channel.

## Local dev / preview

If `PUBLIC_PLAUSIBLE_DOMAIN` is unset (default), no analytics tag is emitted — UTM capture still works, attribution still rides on waitlist submissions, but pageview rollups are skipped. This is intentional so preview deploys don't pollute the prod Plausible site.

## When NOT to use these

- Do **not** put UTM params on links **inside** the site — `sessionStorage` is first-touch only, so internal nav with `?utm_source=...` would no-op anyway, but it pollutes the URL for users sharing the link onwards.
- Do **not** use them on transactional email links (password resets, receipt emails). Reserve `utm_*` for acquisition surfaces.
- Do **not** invent new `utm_source` values without adding them above — channel sprawl makes the rollup useless.
