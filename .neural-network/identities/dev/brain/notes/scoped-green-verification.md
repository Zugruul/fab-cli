---
tags: [gate, lint, workflow]
paths: ["src/**", "test/**"]
strength: 1
source: "PR#47 PRICE-001"
graduated: false
created: 2026-07-12
---

Before debugging a red `npm run gate`, verify YOUR surface scoped-green: npx tsc --noEmit, then eslint/prettier/vitest on just your paths. Ambient tree state (sibling lanes' worktrees, untracked WIP like src/fabtcgLore.ts) can redden the full gate with zero fault in your diff. Never `git stash` in this repo (untracked-heavy tree, sweeps unrelated state); don't read gate exit through a pipe (`| tail` masks $? — use gate.sh's recorded verdict).

Related: [[pricing-cache-contract]]
