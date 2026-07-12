---
tags: [review, types, spec]
paths: ["src/pricing/**", "src/**"]
strength: 2
source: "PR#50 review round 1 (caught PriceRow collision)"
graduated: false
created: 2026-07-12
---

Reviewing a foundation/types-only PR: the real question is "can the next 3 backlog tasks build on this without breaking changes" — read those later tasks, not just this PR's AC. This caught a real defect on PR#50: a raw-API type named identically to the domain type it feeds (PriceRow collision) that would have forced aliasing in the next provider task. Also: grep the WHOLE spec before calling scope creep; check convention reuse; don't demand docs updates for zero-command-surface PRs.
