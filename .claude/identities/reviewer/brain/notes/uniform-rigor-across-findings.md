---
tags: [review, verification, process]
paths: ["pipeline/**", "fab-cli/**", "fab-app/**"]
strength: 1
source: "PR#241 APP-085 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

In a re-check round, apply the same execute-a-poison-input rigor to EVERY finding, not just the MAJOR that got your attention — reviewer's own near-miss on PR#241: finding 1 got an independent mutation re-run, findings 2-3 got only code-reading + suite-green trust. They held, but the asymmetry was luck-shaped. Budget one execution per finding, however minor.

Related: [[execute-load-bearing-mechanism-claims]]
