---
tags: [sorting, comparator, testing]
paths: ["src/**"]
strength: 1
source: "PR#103 (FAB-023) code-quality review round 2"
graduated: false
created: 2026-07-18
---

A date-sort comparator that short-circuits to 0 whenever EITHER side is unparseable ('if (isNaN(a) || isNaN(b)) return 0') breaks Array.sort's transitivity requirement — it silently misorders two PARSEABLE entries whenever an unparseable entry sits between them in the input, because the comparator never directly compares the two parseable entries. Correct pattern: three explicit branches — both-unparseable (0, tie), one-unparseable (route it to a fixed end, e.g. return 1/-1 consistently), both-parseable (real comparison). Caught on PR#103 (FAB-023) via a concrete 3-element reproduction; the bug was invisible to a test that only put the undated entry at one end of the array.

Related: [[assert-exact-values-not-just-counts]]
