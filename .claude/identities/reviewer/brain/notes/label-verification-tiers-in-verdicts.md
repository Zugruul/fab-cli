---
tags: [review, verification, honesty]
paths: ["pipeline/**", "fab-cli/**", "fab-app/**"]
strength: 1
source: "PR#246 #244 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

In a verdict, label each verification by tier — EXECUTED (ran the mechanism), LOGIC-TRACED (read the path end-to-end), GREPPED (searched for coupling) — instead of letting the summary read uniformly execution-verified. PR#246 reviewer's own audit: pytest-unaffected and real-run numbers were grep/trace-tier while the headline claims were execution-tier; the difference matters when a finding later turns out wrong.

Related: [[uniform-rigor-across-findings]] [[execute-load-bearing-mechanism-claims]]
