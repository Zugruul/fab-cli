---
tags: [review, mutation-testing, refactor, test-coverage, construction-proof, failure-direction]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 257 review rounds, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# After a fix-by-extraction: did it CLOSE the gap, or RELOCATE it?

When a review finding ("this logic is untested") is fixed by **extracting**
the logic into a testable pure function, re-running the original mutation is
necessary but **not sufficient** — the mutation now targets the extracted
function, which is of course tested. The real question is whether untested
surface still exists in the glue left behind.

Ask explicitly: *did the extraction close the gap, or move it?*

The strongest possible answer is a **construction argument about failure
direction**: can the residual untested path fail *unsafely* (produce a false
success), or only *safely* (produce a false failure)?

Worked example: an untested exit-code assembly was extracted into a pure
`formatVerifyBuildReport`. The remaining untested glue was the assembly of a
lookup map. Because the formatter does `map.get(id) ?? null` and the decision
function treats a `null` detail as a PROBLEM, breaking or deleting that glue
entirely can only ever yield a false *failure* — never a false success. The
specific bug class ("hidden state reads as success") could not resurface. That
is a genuine close, and it is provable by reading, not by testing.

Asking this routinely has a second payoff: it directs attention at what is
still unreachable from tests, which is how the identical bug shape was then
found one level up (a loop that no test imports, whose unconditional-`break`
mutation passed the entire suite).

Related: [[mutation-is-the-unit-of-proof]].
