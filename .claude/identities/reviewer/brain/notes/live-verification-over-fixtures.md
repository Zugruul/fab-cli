---
tags: [review, verification, live-data]
paths: ["**"]
strength: 1
source: "issues #60/#61, PR#62/#63/#65/#66, session-end retro"
graduated: true
created: 2026-07-12
---

For any feature whose correctness is defined by matching an external live system, fixture-based code review is insufficient alone — fixtures can encode the same wrong mental model as the implementation (this repo's real-data-only bugs passed gate-green fixture tests before a human caught them by comparing output to the actual marketplace pages). Once briefed to independently reproduce cited empirical claims and re-run at least one live smoke test against the REAL external source (not just mocks), reviewers on this epic caught issues repeatedly: recomputing anchoring ratios from live data, re-running export determinism against real APIs, re-verifying doc claims against a fresh live smoke. This pattern is durable enough to be a standing reviewer practice, not a one-off instruction — graduate-candidate.

Related: [[reproduce-gate-claims]] [[isolated-worktree-tdd-proof]]
