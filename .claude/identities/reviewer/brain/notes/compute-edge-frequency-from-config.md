---
tags: [review, config, edge-cases]
paths: ["pipeline/**"]
strength: 1
source: "PR#238 APP-026 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

When a missing test is excused as 'that's an edge case', compute the case's ACTUAL frequency from the committed config's numeric ranges before accepting the framing. PR#238: center draws uniform [0,1), cardHeightFrac ~0.32 → arithmetic showed frame-clipping is common at the shipped defaults, not adversarial — that computation is what made it a MAJOR instead of a nice-to-have. Reading code paths shows possible; plugging in shipped numbers shows common.

Related: [[prefix-swapback-verification]]
