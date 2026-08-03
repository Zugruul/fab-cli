---
tags: [schemas, conventions, datasets]
paths: ["pipeline/**"]
strength: 1
source: "PR#238 APP-026 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

When two producers share a label schema (synthetic composites + real-photo benchmark), internal consistency (label matches own render) is NOT the bar — explicitly diff both protocols' handling of every boundary case (occlusion, cropping, truncation) as its own checklist item. Reading the shared types file is not reading the sibling's protocol doc.

Related: [[boundary-convention-before-first-test]]
