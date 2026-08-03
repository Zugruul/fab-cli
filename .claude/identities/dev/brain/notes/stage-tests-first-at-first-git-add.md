---
tags: [tdd, git, process]
paths: ["pipeline/**", "fab-app/**", "fab-cli/**"]
strength: 1
source: "PR#239 APP-027 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

The red-first rule fails exactly when you build test+impl in tight iterate loops (the correct workflow for hard modules) — there is never a moment where only tests exist. Make 'stage ONLY tests -> commit -> run and confirm the red failure mode -> then stage impl' a literal executed checklist at the FIRST git add of a feature, not something reconstructed at review time. PR#239 cost a full history rewrite for this despite the lesson being injected in the brief.

Related: [[red-commit-contains-only-test-path-files]] [[review-staged-diff-before-commit-message-must-match]]
