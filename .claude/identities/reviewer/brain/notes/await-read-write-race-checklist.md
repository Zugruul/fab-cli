---
tags: [review, concurrency, race, worker-pool]
paths: ["pipeline/**"]
strength: 1
source: "PR#235 APP-025 retro"
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

For shared-mutable-state + worker-pool code (this pipeline's deliberate pattern: cursor + lastRequestAt instead of lock/queue abstractions — rationale documented in images/downloader.ts mirroring qa/runner.ts): list every await between a READ of a shared variable and its matching WRITE, and ask whether a concurrent caller can observe the stale value in that window. PR#235 had two bugs of exactly this shape (retries bypassing the rate gate; the read-sleep-write race filed as #237). Also: check whether qa/runner.ts's original shape has the same race before assuming it was vetted.

Related: [[prefix-swapback-verification]]
