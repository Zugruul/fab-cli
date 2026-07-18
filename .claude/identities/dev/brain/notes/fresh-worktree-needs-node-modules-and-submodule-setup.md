---
tags: [worktree, testing, setup]
paths: ["**"]
strength: 1
source: "PR#91 (issue #7, FAB-012) recovery — gate false-reds in a fresh worktree"
graduated: false
created: 2026-07-18
---

A fresh `git worktree add` checkout has neither `node_modules` (gitignored) nor initialized git submodules (e.g. `third_party/flesh-and-blood-cards`) — running the gate there produces false-looking red failures that have nothing to do with the diff being tested: pricing tests fail because the vendored card DB is empty, and any test spawning `bin/fab.js` as a subprocess fails with `Cannot find module 'tsx'`. Fix cheaply without a slow reinstall/reclone: symlink `node_modules` from the main checkout (`ln -s <main-checkout>/node_modules node_modules` — first `rm -rf` any pre-existing empty `node_modules` dir the worktree may already have, or the symlink lands inside it instead of replacing it), and `rsync -a --exclude='.git' <main-checkout>/third_party/flesh-and-blood-cards/ third_party/flesh-and-blood-cards/` for the submodule (avoid `git submodule update` in a worktree — it can hang for minutes if another concurrent session is touching the same shared `.git/modules/` state, which is NOT per-worktree). Always verify a red result reproduces on a *properly set up* clean base before treating it as evidence about the diff under test.
