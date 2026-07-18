---
tags: [testing, review, rigor]
paths: ["test/**"]
strength: 1
source: "PR#75 (issue #6, FAB-011)"
graduated: false
created: 2026-07-18
---

A test that only checks a call count (`sleeps.length === 3`) or a one-sided bound (`peak <= max`) can pass under a broken implementation — constant-delay backoff instead of exponential, or a limiter that silently serializes everything (effective max=1). When reviewing retry/backoff or concurrency-limiter tests, demand the actual values be asserted: the real backoff sequence (`[300, 600, 1200]`, not just length 3) and that peak concurrency actually reaches the configured max (`peak === max`), not merely stays under it. Caught in PR #75's http.ts tests — both gaps were real and got fixed on request.
Related: [[reproduce-gate-claims]]
