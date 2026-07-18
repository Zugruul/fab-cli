---
tags: [orchestration, briefing, git]
paths: ["**"]
strength: 1
source: "PR#89 (TAL-001) retro — both agents hit shared-checkout contention"
graduated: false
created: 2026-07-18
---

Bake into every dev/reviewer brief up front: the repo checkout is shared with concurrent sessions — never switch its branch; do fix rounds and review test-runs in a private `git worktree` (remove with `--force` here: npm postinstall inits submodules). Sending this reactively after a near-miss is too late; it belongs in the initial brief template.
