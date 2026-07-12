---
tags: [testing, pricing]
paths: ["test/**"]
strength: 1
source: "PR#57"
graduated: false
created: 2026-07-12
---

For small combinatorial domains (4 condition columns → 16 present/absent patterns), table-test the FULL space with per-column-distinct values asserting both value and label — cheaper to write than to argue about which patterns matter, and it caught nothing on PR#57 precisely because the dev wrote it before the reviewer could ask. Snapshot of a good pattern: distinct prices 100/200/300/400 so wrong-source copies are visible in the value too.

Related: [[test-must-falsify]]
