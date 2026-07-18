---
tags: [parsing, regex, testing, verification]
paths: ["src/rules.ts", "src/**"]
strength: 1
source: "PR#94 (FAB-020) round 2->3, TRP dash-range false-positives survived the first regex fix"
graduated: false
created: 2026-07-18
---

When a text-parsing regex is tightened to reject one observed false-positive pattern, verify the fix by scanning the FULL real source file for remaining matches (count before/after), not just re-checking the one reported example — a narrow fix (e.g. reject lowercase-starting titles) can leave a sibling false-positive shape (e.g. dash-range rows) in the same document untouched, since both violate the same underlying assumption (heading titles are prose) in different superficial ways.

Related: [[scoped-green-verification]]
