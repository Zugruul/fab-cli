---
tags: [board, hooks, process]
paths: []
strength: 1
source: "APP-001 QA-gate bypass incident"
confidence: direct
graduated: false
created: 2026-08-01
last-touched: 2026-08-01
---

Never chain board status moves unconditionally in one shell command: a hook-blocked transition exits nonzero but subsequent chained moves still execute, silently bypassing the gate (observed: blocked QA gate, then chained Ready+Deployed both landed). Move one status at a time, read each result; revert honestly if a gate was skipped.
