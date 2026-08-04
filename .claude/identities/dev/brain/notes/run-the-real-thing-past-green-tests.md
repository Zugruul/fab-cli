---
tags: [integration, cli, testing]
paths: ["pipeline/**"]
strength: 1
source: "PR#243 APP-029 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Green unit tests over self-shaped fixtures never cross integration seams — run the REAL entry point end-to-end against real files before calling a CLI-bearing task done. PR#243: 66 green tests missed both real bugs (JSON cannot carry a Map into the config path; a cross-check comparing against the honest-absent sentinel would have failed every real dry-run); both were found in minutes by manually running dry-run. The manual run is not optional polish, it is the cheapest integration test that exists.

Related: [[read-producers-real-bytes-before-fixtures]] [[test-knob-intersections]]
