---
tags: [polling, caching, design]
paths: ["src/**"]
strength: 1
source: "PR#106 (FAB-040) — my own design doc's ttlMs=intervalMs choice, caught by both review passes"
graduated: false
created: 2026-07-18
---

For a real-time polling feature, wrapping a per-tick fetch in a disk cache with 'ttlMs = pollIntervalMs' is a design trap: since ticks are spaced by a real delay that fires at-or-after the interval (never before), elapsed time between consecutive cache checks is always >= ttlMs, making the cache a PERMANENT miss by construction — not an occasional one. The fix is never to bump the TTL above the interval (that would make it genuinely hit and serve stale data mid-session, a real correctness regression) — it's to recognize the cache adds no value for THIS access pattern and remove it, relying instead on whatever content-level diffing (a seen-items Set, a hash comparison) is the actual 'skip reprocessing unchanged data' mechanism.

Related: [[pagination-cap-check-before-vs-after-fetch]]
