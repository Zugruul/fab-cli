---
tags: [gate, lint, infra, concurrency]
paths: [".claude/**", "eslint.config.mjs"]
strength: 1
source: "PR#47 / bug #48"
graduated: false
created: 2026-07-12
---

The full-repo gate can go red from AMBIENT tree state, not the branch: sibling agents' worktrees under .claude/worktrees/**, vendored venvs (.venv*/**), and untracked WIP in src/ from another lane. Fixed structurally for the first two via eslint ignores (merged in 9180359, bug #48). Remaining hazard: another lane's untracked src/*.ts WIP still lints. Before blaming a branch: `git status --porcelain src/` for untracked files + reproduce. Structural option if it recurs: lint tracked files only, or per-task worktrees.

Related: [[gh-pr-merge-diverged-local]]
