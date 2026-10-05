---
tags: [review, regression-tests, verification]
paths: ["pipeline/**", "fab-cli/**", "fab-app/**"]
strength: 1
source: "PR#235 APP-025 retro"
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

To verify a new regression test actually kills the bug it claims to: swap the pre-fix file back in and RUN the test against it (expect fail), then restore and re-run green. Converts 'I traced this and it should fail' into verified fact in under a minute; catches too-loose assertions and fixtures that accidentally sidestep the bug path. Used on PR#235 round 2.

Related: [[await-read-write-race-checklist]]
