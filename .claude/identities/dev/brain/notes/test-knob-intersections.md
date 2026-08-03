---
tags: [testing, tdd, composition]
paths: ["pipeline/**"]
strength: 1
source: "PR#235 APP-025 retro"
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Before calling a feature done, deliberately test the INTERSECTIONS between its independent-seeming mechanisms, not each in isolation. Both PR#235 review bugs were intersection bugs: rate-limit x retry (retries bypassed the gate entirely) and write x cache-resume (a truncated write became a permanent fake cache hit). A redgreen suite per mechanism proves nothing about their composition.

Related: [[verify-vendor-id-uniqueness]]
