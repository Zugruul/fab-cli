---
tags: [testing, images, bilinear]
paths: ["pipeline/**"]
strength: 1
source: "PR#254 #252 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Bilinear sampling blends adjacent source pixels at EVERY dst pixel — even pure-translation placements land at half-integer offsets — so 'exact pixel count' test assertions only hold for axis-aligned + uniform-alpha fixtures. Any fixture with internal alpha structure (holes, gradients) needs an inequality bound or a hand-derived boundary-pixel analysis, never naive area subtraction. PR#254: a transparent-hole fixture's exact-count draft was wrong for exactly this reason.

Related: [[boundary-convention-before-first-test]] [[test-knob-intersections]]
