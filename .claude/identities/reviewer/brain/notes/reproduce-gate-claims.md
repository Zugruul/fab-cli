---
tags: [gate, verification, review]
paths: ["**"]
strength: 2
source: "PR#47 review round 1; reinforced PR#109 (TAL-021) — self-reported 515/525 turned out to be a stale-worktree artifact, real result was 559/559 clean"
graduated: false
created: 2026-07-12
---

Never accept an author's "gate red is unrelated contamination" from the PR body — check out the branch and reproduce (`npm run gate`, repo-wide eslint) yourself. It was true on PR#47, but only reproduction could show that; an author-written excuse for a red gate is precisely the claim needing independent verification. Cheap hard-to-fake TDD check: `git log` ordering — test commit strictly before impl commit, touching only test files.

This applies to self-reported PASSING numbers too, not just claimed-red-is-unrelated excuses: a PR claiming "515/525, 10 pre-existing failures" can be simply wrong if the author's own environment had a stale/drifted dependency (e.g. an under-synced vendored submodule) — reproducing in a freshly-set-up environment showed 559/559 clean. A discrepancy between the claimed and reproduced numbers is itself a finding worth surfacing, even when it turns out to favor the PR (nothing was actually broken).

For the `git log` ordering check specifically: `git log`'s default display is newest-first, so eyeballing top-to-bottom silently inverts the "test before implementation" story. Sort by `%ci`/`%ct` explicitly, or use `--reverse`, and confirm which end is actually oldest before asserting TDD ordering held.
