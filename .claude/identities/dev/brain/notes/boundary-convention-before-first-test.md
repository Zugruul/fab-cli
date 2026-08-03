---
tags: [geometry, conventions, testing]
paths: ["pipeline/**"]
strength: 1
source: "PR#238 APP-026 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

For any pure geometry/transform function whose output can legitimately leave its bounded domain (off-canvas coords, out-of-frame, saturation), decide and WRITE DOWN the domain-boundary convention (clamp vs pass-through, modal vs amodal) as an explicit line item before the first test. Boundary behavior is invisible in happy-path math and ships as 'undefined but currently fine' — PR#238's only MAJOR was exactly this: code already correct, convention undecided/undocumented.

Related: [[test-knob-intersections]] [[shared-schema-diff-sibling-protocols]]
