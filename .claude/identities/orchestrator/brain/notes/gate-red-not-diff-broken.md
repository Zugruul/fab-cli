---
tags: [gate, triage, process]
paths: ["**"]
strength: 1
source: "PR#73 (issue #72)"
graduated: false
created: 2026-07-17
---

Rule #10 (local gate red != diff broken) has a companion case: sometimes the gate is ALREADY red on clean main, unrelated to any pending diff. When next-task's top unblocked candidates turn out closed/owner-deferred, don't just stop — actually reproduce the gate on main before concluding backlog is empty. A gate-red-on-main is itself the highest-priority actionable work, worth filing as a P0 bug and fixing before anything else, since it silently blocks every future task's gate check.
Related: [[stale-mock-arity-and-global-leak]]
