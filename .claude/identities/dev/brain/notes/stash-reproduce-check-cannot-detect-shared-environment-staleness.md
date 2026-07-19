---
tags: [worktree, testing, gate, verification]
paths: ["**"]
strength: 1
source: "PR#109 (TAL-021) loop-feedback"
graduated: false
created: 2026-07-18
---

A dev agent's own 'stash my changes and reproduce the failure on the unmodified tree' check does not prove a gate failure is genuinely pre-existing on the true base branch if the agent's own working environment (a fresh worktree) has independent staleness (an under-synced submodule, a broken dependency symlink) -- both the stashed and unstashed states share that same staleness, so the check only isolates 'caused by my diff' vs 'not caused by my diff', never 'real on main' vs 'artifact of my own setup'. Verifying gate claims from a properly, freshly, independently synced environment is what actually distinguishes those two cases -- this is why a reviewer reproducing the gate in ITS OWN isolated worktree catches things the author's self-check cannot.
