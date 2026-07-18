---
tags: [pagination, http, efficiency]
paths: ["src/**"]
strength: 1
source: "PR#104 (FAB-024) code-quality review round 1"
graduated: false
created: 2026-07-18
---

A safety-cap check placed BEFORE a paginated fetch (e.g. 'for (page=1; collected.length < MAX; page++)') lets the loop fetch one full extra page beyond the cap before the post-loop truncation catches it — bounded, minor waste (one page's worth of unneeded parse work), not a correctness bug given a trailing .slice(0, MAX). Caught on PR#104 (FAB-024) code-quality review; judged non-blocking since the real-world corpus was far under the cap, but worth knowing the pattern: checking the cap AFTER a page arrives (before deciding whether to fetch the next one) avoids the overshoot entirely.

Related: []
