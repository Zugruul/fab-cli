---
tags: [review, geometry, datasets]
paths: ["pipeline/**"]
strength: 1
source: "PR#255 #253 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Layout/geometry-feature review checklist: (a) hand-measured geometry is unverifiable from the diff — crop the REAL reference image at the committed rects and eyeball (cheap, decisive); (b) domain-invariant claims in selection predicates ('X and Y never co-occur', 'Z nonempty') verified against the FULL real dataset, never the fixture (fixtures satisfy whatever the author believes; claims rot as vendored data updates); (c) decode ONE real end-to-end output and hand-verify domain correctness (ids -> names -> right zones) — categorically different evidence than tests-pass; (d) any categorical per-card exclusion (isCardBack-style parallel arrays) needs index-alignment probing — an early continue before all pushes is invisible to non-probing tests.

Related: [[execute-load-bearing-mechanism-claims]] [[derived-identifier-collision-checklist]]
