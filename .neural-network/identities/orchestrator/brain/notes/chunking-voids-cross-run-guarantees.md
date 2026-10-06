---
tags: [orchestration, chunking, guarantees, state, distribution-reporting]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 268, 2026-08-05
graduated: false
created: 2026-08-05
last-touched: 2026-08-05
---

# Chunking a job can silently void guarantees that span the job

Splitting a long run into parts to fit an execution constraint destroys any
correctness property defined **across** the run rather than within a chunk —
and it does so invisibly, because the parts produce the expected output volume
and individually plausible reports.

Worked example: a generation run was too long for the execution environment,
so it was split into four. Each part constructed its own coverage tracker
**from zero**, so the guarantee "every item appears at least N times across the
run" was never satisfied. Four chunks × 5,200 composites produced the right
total count and four reports that each looked fine. The tell was the per-run
summary printing `min=0, max=1`.

**Before splitting a run, enumerate which properties span it:**
accumulators, coverage/quota targets, global fairness or balance, cross-item
deduplication, monotonic counters, anything seeded once. If any exist, the
split must **carry state between chunks** — otherwise it is invalid, not merely
approximate.

**Design corollary:** per-run summaries should print the **distribution**
(min/max/percentiles), not just totals. A total is compatible with total
failure of a per-item guarantee; a `min=0` is not. That one field is what made
this visible at all.

Related: [[coverage-reports-partition-the-full-domain]],
[[mechanism-correct-but-never-triggered]].
