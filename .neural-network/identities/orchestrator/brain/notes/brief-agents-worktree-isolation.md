---
tags: [orchestration, briefing, git]
paths: ["**"]
strength: 3
source: "PR#89 (TAL-001) retro — both agents hit shared-checkout contention; reinforced PR#101 (TAL-012) — orchestrator's own branch switch collided with a subagent's live shared-checkout work; confirmed working PR#107 (TAL-020) — a genuinely isolated worktree lane avoided any collision with a concurrent session's simultaneous merges to mainBranch"
graduated: false
created: 2026-07-18
---

Bake into every dev/reviewer brief up front: the repo checkout is shared with concurrent sessions — never switch its branch; do fix rounds and review test-runs in a private `git worktree` (remove with `--force` here: npm postinstall inits submodules). Sending this reactively after a near-miss is too late; it belongs in the initial brief template.

The risk isn't only OTHER sessions — the ORCHESTRATOR's own later branch switches in the same shared checkout (e.g. moving to the next task's feature branch, or briefly checking out main for a housekeeping commit) can just as easily collide with a subagent it is currently running there. True worktree-per-subagent isolation removes this whole class of mistake; when not using it (e.g. because the checkout was clean at spawn time), the orchestrator must apply the SAME discipline to itself that it demands of subagents — verify current branch before every operation, never assume the checkout is still on the branch you last left it on.
