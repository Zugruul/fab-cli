---
tags: [research, grep, code-study]
paths: ["**"]
strength: 1
source: "PR#102 (TAL-013) dev retro"
graduated: false
created: 2026-07-18
---

For 'beyond the docs' research gaps (finding a second real example, a hidden pattern's concrete shape), grep the CONSEQUENCE of the pattern, not the pattern's name. Searching for a function CALL SITE (e.g. IncrementClassState() invocations) and eyeballing which ones share the documented example's structural shape (same sequencing, same surrounding logic) surfaces real second examples that a name-search misses -- the target isn't always near the term you'd naively search for.
