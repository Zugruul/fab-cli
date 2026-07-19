---
tags: [verification, pipeline, research]
paths: ["**"]
strength: 1
source: "PR#112 (TAL-022) dev retro"
graduated: false
created: 2026-07-18
---

Never trust an inherited 'confirmed missing/present' claim at face value across tasks in a pipeline -- re-derive it yourself with the right check before building on it. A wrong verification method (e.g. checking a snake_case ID against a file that stores title-case names) produces false confidence that compounds across later tasks if nobody re-checks it. Verify the check itself was sound before trusting its conclusion, especially when a later task's work depends on an earlier task's stated finding.
