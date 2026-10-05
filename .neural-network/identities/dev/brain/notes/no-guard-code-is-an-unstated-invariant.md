---
tags: [invariants, collisions, testing]
paths: ["pipeline/**"]
strength: 1
source: "PR#243 APP-029 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

'No collision-prevention code' and 'no way to collide' are different claims — only one is checkable by reading. The adversarial-test checklist naturally covers every place you BUILT disambiguation into (named properties) and implicitly trusts every place you didn't (unstated invariants). For every identifier DERIVED from caller input (basename/slug/prefix) that feeds a write target or dedup key, ask the distinctness question explicitly — especially where no guard exists, because that is where nothing ever claimed safety.

Related: [[adversarial-fixture-orderings-for-invariants]] [[boundary-convention-before-first-test]]
