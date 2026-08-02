---
tags: [review, docs, claims]
paths: ["**"]
strength: 1
source: ""
learned-from: task 218 round-1 finding
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Treat every PR-body sentence of the form "file/doc X notes/records/extends Y" as a testable assertion, not narrative: grep X for Y's distinctive keywords before trusting it. One grep per claim, run before writing any other finding. This exact check caught #218's only defect (the PR body claimed the spec delta carried a design-doc extension note; grep of the delta for "app-E3"/"design"/"fold" returned zero hits). Cheap, mechanical, catches intent-described-as-artifact drift.
