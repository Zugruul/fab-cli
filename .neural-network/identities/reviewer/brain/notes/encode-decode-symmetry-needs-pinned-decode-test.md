---
tags: [review, training, symmetry]
paths: ["pipeline/**"]
strength: 1
source: "PR#239 APP-027 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

When target-encoding and inference-decoding live in different modules (encode.py -> torch_data.py -> train.py), require a pinned-value test on the DECODE side fed with a synthetic known tensor — channel-order regressions there converge to garbage silently while one-sided unit tests stay green. Manual trace is not a regression lock.

Related: [[amodal-labels-contract-watchpoint]] [[execute-load-bearing-mechanism-claims]]
