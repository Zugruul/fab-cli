---
tags: [testing, review, verification]
paths: ["test/**"]
strength: 1
source: "PR#74 (issue #5)"
graduated: false
created: 2026-07-18
---

Don't trust a claimed test repro — yours or another agent's — rerun the negative control yourself. When a dev agent reports 'I added a throwaway case, saw N failures, reverted, confirmed green', that's a claim to verify, not evidence: add/remove your own throwaway item on the live system and confirm the test fails/passes for the right reason before approving. Cheap (~1 min) and closes the gap between 'plausible-sounding proof' and 'independently confirmed proof'.
Related: [[self-referential-coverage-tests]] [[reproduce-gate-claims]]
