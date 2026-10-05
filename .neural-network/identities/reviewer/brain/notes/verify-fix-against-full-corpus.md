---
tags: [review, regex, parsing, verification]
paths: ["src/rules.ts", "test/rules.test.ts"]
strength: 1
source: "PR#94 (FAB-020) round 3 re-review"
graduated: false
created: 2026-07-18
---

When reviewing a fix for a text-parsing false-positive (regex/heuristic), don't just confirm the ONE reported example is now rejected — re-run the parser against the FULL real source file and diff the before/after match set. Caught a real bug on PR#94 (FAB-020): round-2's regex fix eliminated the exact 'minutes'-table false positive but left a structurally identical 'dash-range'-table false positive (16/102 = 16% of TRP chunks) in the same document, undetected by only re-checking the original example.

Related: [[reproduce-gate-claims]] [[assert-exact-values-not-just-counts]]
