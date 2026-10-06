---
tags: [testing, performance, gate, flake]
paths: ["**"]
strength: 1
source: ""
confidence: direct
learned-from: task 225
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Never assert a device/production performance TARGET as a wall-clock bound in the merge gate — shared-host load makes it a false-red generator (a 50ms on-device p95 target asserted in jest flaked at 51.58ms under a parallel gate run; a retry-once tolerance (#210) still failed under SUSTAINED load). Gate-side perf tests get a named PATHOLOGICAL smoke bound (~10x worst observed load-induced value), documented as regression-catch-only, with the real measurement logged as a non-asserting diagnostic; precision targets live in the release-gated device-benchmark protocol (§8.6). Mutation-prove the smoke bound still catches a genuine pathological slowdown before shipping it.
