---
tags: [gate, verification, review]
paths: ["**"]
strength: 1
source: "PR#47 review round 1"
graduated: false
created: 2026-07-12
---

Never accept an author's "gate red is unrelated contamination" from the PR body — check out the branch and reproduce (`npm run gate`, repo-wide eslint) yourself. It was true on PR#47, but only reproduction could show that; an author-written excuse for a red gate is precisely the claim needing independent verification. Cheap hard-to-fake TDD check: `git log` ordering — test commit strictly before impl commit, touching only test files.
