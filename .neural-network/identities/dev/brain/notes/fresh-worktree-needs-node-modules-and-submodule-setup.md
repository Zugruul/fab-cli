---
tags: [worktree, setup, venv]
paths: ["pipeline/**", "fab-app/**"]
strength: 3
source: "PR#246 #244 retro (broadened re-mint)"
graduated: false
created: 2026-07-18
last-touched: 2026-08-04
---

Fresh worktrees need node_modules (pnpm install) AND the train-vision venv — and the venv is CHEAP (pip install -e '.[dev]' pulls torch/litert from local cache in ~2 min). Budget for full setup rather than skipping test:py; a lane that skips the Python half ships an unverified gate claim.
