---
tags: [briefing, scoping, board]
paths: ["**"]
strength: 1
source: "FAB-025 (#22) — task title implied ground-up build, actual remaining scope was fixture tests only"
graduated: false
created: 2026-07-18
---

A board task's real remaining scope can be much narrower than its title/AC suggest if the underlying feature already shipped ahead of the board (common when a dev landed working code before a formal task existed, then an owner comment cross-references it). Before briefing a dev agent on a task whose title implies building something from scratch, check whether the described deliverable already exists on main and read every human comment on the issue — one comment named the exact single remaining gap (fixture tests) for a task whose title otherwise implied vendoring a submodule and building a whole search feature from zero.

Related: []
