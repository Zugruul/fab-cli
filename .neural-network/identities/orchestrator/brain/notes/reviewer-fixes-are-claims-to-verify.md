---
tags: [review, briefing, delegation]
paths: [".claude/**"]
strength: 1
source: "APP-024 iteration feedback"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

A reviewer-prescribed fix is a CLAIM like any other — verify it against the runtime/bundler before complying literally. PR#248: the reviewer asked for a node:perf_hooks import that tsc+jest accept but Metro cannot resolve; the dev grepped precedent, verified the RN global, and shipped the correct alternative with documented reasoning. Relay reviewer fixes to devs as claims-to-verify, never as orders.

Related: [[moment-of-action-enforcement-beats-brief-text]] [[outward-action-blockers-are-one-bucket]]
