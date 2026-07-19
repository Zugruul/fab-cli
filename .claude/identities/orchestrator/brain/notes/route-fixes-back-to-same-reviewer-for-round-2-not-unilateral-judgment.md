---
tags: [review, fix-rounds, orchestration]
paths: ["**"]
strength: 1
source: "PR#113 (TAL-024) loop-feedback"
graduated: false
created: 2026-07-19
---

When a dev agent fixes a reviewer-found blocking issue, route the fix back through the SAME reviewer(s) for an explicit round-2 verdict rather than having the orchestrator unilaterally judge the fix sufficient from its own gate-green reproduction alone. A reviewer re-checking a fix asks a different, complementary question ('did this fix the underlying problem without weakening the check') than an orchestrator's gate-green reproduction does ('does the test currently pass') -- both are needed to trust a fix round is genuinely resolved, not just made to look resolved. Concretely: diff what changed in the test's ASSERTIONS across the fix, not just whether they now pass.
