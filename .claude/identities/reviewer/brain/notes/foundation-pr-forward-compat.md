---
tags: [review, types, spec]
paths: ["src/pricing/**", "src/**"]
strength: 1
source: "PR#47 review round 1"
graduated: false
created: 2026-07-12
---

Reviewing a foundation/types-only PR: the real question is "can the next 3 backlog tasks build on this without breaking changes" — read those later tasks, not just this PR's AC. Grep the WHOLE spec for a type/field before calling scope creep (PriceSource's avg30/avg7/avg1 looked beyond §8.1 but §8.3's cascade requires them). Check convention reuse vs reinvention (e.g. ~/.config/fabrary-search/ from src/config.ts). Do NOT demand README/CLAUDE.md updates when there's zero command-surface change and a dedicated docs task exists.
