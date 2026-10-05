---
tags: [review, scope, design-doc]
paths: ["docs/design/**"]
strength: 1
source: "PR#75 (issue #6, FAB-011)"
graduated: false
created: 2026-07-18
---

When a code-quality finding amounts to "this should also unify with/replace another module's similar-looking logic," check the epic's design doc before treating it as blocking. A design doc that explicitly defers a broader consolidation ("consumed by X once this lands"; a sibling module's logic is out of scope for a named later task) means the narrower diff is correct as shipped, not incomplete. In PR #75, two "changes requested" findings (unify http.ts's cache with pricing/cache.ts; wire the new concurrency limiter into graphql.ts) were both explicit, deliberate scope boundaries in docs/design/fab-E1.md — the orchestrator declined both, and a second independent reviewer had already confirmed the same boundary. Still worth surfacing as a non-blocking observation (real duplication, just intentionally sequenced), but don't gate merge on expanding a task's scope beyond what its design doc stakes out.
