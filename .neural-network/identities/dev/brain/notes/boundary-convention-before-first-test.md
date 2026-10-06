---
tags: [geometry, math, conventions, testing]
paths: ["pipeline/**"]
strength: 2
source: "PR#240 APP-028 retro (broadened re-mint)"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

For any pure function whose output can legitimately leave its bounded domain — geometry (off-canvas), math formulas (trig wraparound past pi-margin, saturation, division near zero) — decide and WRITE DOWN the domain-boundary behavior as an explicit line item before the first test. The habit must transfer ACROSS domains: PR#238 pinned the geometry boundary up front, PR#240 pinned geometry again but missed the trig boundary in ArcFace — same class of gap, different domain. Ask per function: what is the full valid input domain, and does behavior invert anywhere in it?
