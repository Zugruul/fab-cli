---
tags: [fixtures, contracts, integration]
paths: ["pipeline/**"]
strength: 1
source: "PR#239 APP-027 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Before writing an adapter or fixtures for another module's output, read one REAL on-disk example of the producer's bytes. PR#239: geometry/encode assumed [x,y] array corners, fixtures encoded the same wrong assumption, every unit test passed — only a real integration smoke against actual composites:generate output caught the {x,y} dict shape. Hand-written fixtures validate your assumption, not the contract.

Related: [[shared-schema-diff-sibling-protocols]] [[test-knob-intersections]]
