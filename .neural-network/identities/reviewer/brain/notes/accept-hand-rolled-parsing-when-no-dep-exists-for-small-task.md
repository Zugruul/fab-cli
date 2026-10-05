---
tags: [review, testing, dependencies]
paths: ["test/**"]
strength: 1
source: "PR#101 (TAL-012) code-quality review"
graduated: false
created: 2026-07-18
---

Don't reflexively flag a hand-rolled parser (e.g. a bounded regex reading a config file) as a defect just because a proper library would be cleaner -- check whether that library is already a project dependency first. If it isn't, and the task is small/structural, adding a new dependency purely for one test is a worse tradeoff than a tightly-scoped, well-anchored regex. Only push back when the regex is loosely bounded or the underlying file is complex enough that drift risk is real.
