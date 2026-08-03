---
tags: [review, docs, consistency]
paths: ["pipeline/**", "fab-cli/**", "fab-app/**"]
strength: 1
source: "PR#239 APP-027 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Pick the 1-2 nouns central to the PR's key design decision and grep EVERY file mentioning them, side by side. Divergent claims about the same fact (PR#239: licenses.py said 'torchvision MobileNetV3 topology' while model.py/README said zero-torchvision) mean a mid-implementation pivot not swept through all comments — an architecture id naming the abandoned design (obb-centernet-mnv3s) is the same tell. In source-of-truth files (license tables, validators, config enums) every docstring claim is a testable assertion, not documentation.

Related: [[execute-load-bearing-mechanism-claims]]
