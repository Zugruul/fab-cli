---
tags: [testing, regression-locks, mutation-testing, security, test-shape]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 258 review rounds 2-4, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# A regression test must reproduce the bug's MECHANISM, not resemble its inputs

A test whose inputs merely *look like* the bug's inputs, without exercising
the substrate the bug actually lives in, asserts exactly the thing the bug
already evades — and passes forever while the bug is live.

Worked example: a path-containment bug was fixed and covered by 8 tests, all
using **string payloads** (`../`, `%2e%2e`, absolute paths). The next review
round staged a **real symlink** and walked straight through the fix. The
tests resembled the attack's inputs; they did not reproduce its mechanism,
because the mechanism was filesystem resolution, not string parsing.

**Rule:** when a defect lives in a substrate the existing tests only simulate,
mandate that its regression test use the **real substrate** — a real symlink,
a real pointer event, a real file, a real network condition. Applied here as
a brief instruction ("test it with a real staged symlink, not a string"), it
was then adopted unprompted by the author for a further sub-case.

This is the specific form the [[mutation-is-the-unit-of-proof]] discipline
takes when the bug is environmental rather than logical: mutation proves the
test can fail; real-substrate proves the test is *pointed at the right thing*
in the first place. Both are needed — a mutation-proven test aimed at the
wrong substrate is still a test that cannot see the bug.

Related: [[verification-has-an-axis]].
