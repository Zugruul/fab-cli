---
tags: [pricing, http, consistency]
paths: ["src/pricing/**"]
strength: 1
source: "PR#53 review round 1"
graduated: false
created: 2026-07-12
---

When adding a client next to existing siblings (tcgcsv, tcgplayerSearch, cardmarket), diff your module against BOTH siblings for cross-cutting behaviors before opening the PR: retry/backoff, typed HTTP errors, injectable fetchFn, option names (retryBaseMs, cacheDir, refresh). PR#53 shipped without the retry/backoff every sibling had — spec §6.4 applies to every external host, not just the ones the task text mentions.

Related: [[pricing-cache-contract]] [[untyped-api-optional-fields]]
