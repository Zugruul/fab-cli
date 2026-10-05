---
tags: [briefing, tdd, regression]
paths: [".claude/**"]
strength: 1
source: "#253 iteration feedback"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Brief rule: red-first for features, KILL-FIRST for regression locks — any regression test whose bug was caught manually (eyeball, not a failing test) must include a demonstrated mutation kill in its commit evidence, because the author never saw it fail and vacuity is the default. PR#255: both the original test AND the first fix were vacuous; only the mutation cycle proved the final one.

Related: [[moment-of-action-enforcement-beats-brief-text]] [[reviewer-fixes-are-claims-to-verify]]
