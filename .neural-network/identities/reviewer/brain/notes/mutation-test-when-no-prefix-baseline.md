---
tags: [review, test-rigor, verification]
paths: []
strength: 1
source: "PR #216 round 1 (uncovered dispatched-state write)"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

When reviewing NEWLY-created code there is no pre-fix baseline to run tests against — the equivalent evidence standard is targeted mutation testing: on a scratch copy, break each load-bearing behavior one at a time (drop a state write, flip a config flag, remove a field) and require some test to fail for each. On APP-020 this found the one silently-uncovered load-bearing write in an otherwise exact-value suite: the dispatched-stage state persistence that the entire resumability guarantee rests on — all 27 tests passed with it deleted. Reviews that only READ new tests rate coverage by intention; mutations rate it by consequence. Pick mutations by asking which single line, if lost in a refactor, silently breaks a headline requirement.
