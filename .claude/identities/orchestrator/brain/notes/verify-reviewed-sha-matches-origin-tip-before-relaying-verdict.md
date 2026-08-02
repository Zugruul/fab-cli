---
tags: [review, concurrency, staleness]
paths: ["**"]
strength: 1
source: ""
learned-from: task 217
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

A reviewer's verdict is only as fresh as the SHA it reviewed. In #217, the reviewer's REQUEST_CHANGES round 1 was produced against a stale fetch (tip 9263c8b6) while the dev had already pushed 3 commits fixing every finding (tip 666f7281) — the round was wasted and the verdict narrative ("uncommitted fixes on the shared tree") was confidently wrong. Before acting on ANY verdict (relaying findings to the dev, or merging on an APPROVE): compare the SHA the reviewer says it reviewed against `git fetch && git rev-parse origin/<branch>` yourself; a mismatch means send the reviewer back with the fresh tip, not relay the findings. Corollary when briefing: tell the reviewer the exact tip SHA to review and to re-fetch first — especially when a dev agent may still be pushing.
