---
tags: [review, cli, docs]
paths: ["fab-app/**", "pipeline/**"]
strength: 1
source: "PR#245 APP-036 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

Any CLI subcommand not invoked by the pipeline's orchestrating script is a doc-drift risk by construction. Check as its own line item: every subcommand is either (a) called by the main script, or (b) explicitly labeled manual-only in BOTH the code comment and the docs. PR#245: ensure-tester-group was dead code documented as automatic.

Related: [[default-drift-and-failure-coverage-checks]] [[execute-load-bearing-mechanism-claims]]
