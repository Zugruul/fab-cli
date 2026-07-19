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

A specific, recurring failure mode worth naming explicitly: a committed test that reads GITIGNORED files (session-local artifacts a dev agent's own working directory happens to contain, e.g. `.claude/talishar/dossiers/*.md`) will report "gate green, N/N passing" truthfully in that one environment while permanently failing on every fresh clone, CI run, or other contributor's checkout. Reproducing gate claims must happen in a checkout that NEVER shared filesystem state with the one that produced the claim -- a genuinely new `git worktree add`/`git clone` that the dev agent's session never populated, NOT the dev agent's own worktree (gitignored files are per-directory, not shared across worktrees, but re-using or `cd`-ing into the SAME worktree the dev agent used will still see whatever it left on disk). Caught independently by two reviewers plus the orchestrator on PR#113 (TAL-024), each verifying in their own separate fresh worktree.
