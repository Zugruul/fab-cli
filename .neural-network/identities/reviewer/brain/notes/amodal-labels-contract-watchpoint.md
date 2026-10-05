---
tags: [review, labels, contract, detector]
paths: ["pipeline/**"]
strength: 1
source: "PR#238 APP-026 retro"
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Cross-cutting contract since APP-026: composite AND real-photo benchmark labels are AMODAL — out-of-canvas quad coords are legitimate ground truth (convention pinned in benchmark-labeling.md + composites/geometry.ts). Any downstream IoU/NMS/target-encoding/eval code must handle out-of-bounds quads explicitly; a silent 'safety' clamp reintroduces the exact train/eval mismatch this convention eliminated. Standing checklist item for detector/eval PRs.
