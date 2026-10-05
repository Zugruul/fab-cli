---
tags: [concurrency, git, retro]
paths: ["**"]
strength: 1
source: "TAL-003 iteration retro (orchestrator observation)"
graduated: false
created: 2026-07-18
---

At the start of every iteration, before touching the board or main, run `git status` on the shared checkout. If it shows uncommitted retro-shaped state (brain notes, feedback yaml, links.json, DIRECTORY.md) left over from a prior session that ended before its retro commit landed, treat it as prior work to commit or investigate — never discard. A retro that never reaches a completed commit is invisible to ancestry checks (git merge-base --is-ancestor) and can silently duplicate across sessions or across a recovery worktree created for an unrelated incident.
