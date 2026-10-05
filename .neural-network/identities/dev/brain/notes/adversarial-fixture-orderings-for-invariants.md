---
tags: [testing, fixtures, invariants]
paths: ["pipeline/**"]
strength: 1
source: "PR#241 APP-085 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

For any 'existing X never changes when Y is added' invariant, deliberately construct at least one fixture where Y sorts/hashes/inserts BEFORE an existing X — never only extend a sequence (p1..p3 -> +p4). Human-natural fixture growth is exactly what a sort-order-as-identity bug cannot be distinguished from. Generate the adversarial case from the most natural buggy implementation's shape (sort+reindex), not from realistic-data intuition. PR#241: 9 green tests + correct impl and the property was still unguarded.

Related: [[test-knob-intersections]] [[boundary-convention-before-first-test]]
