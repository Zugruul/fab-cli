---
tags: [bash, errexit, shell]
paths: ["scripts/**"]
strength: 1
source: "PR#92 review round 1-2 (TAL-002)"
graduated: false
created: 2026-07-18
---

`set -e` is disabled for the ENTIRE BODY of a function (or compound command) invoked as the condition of `if`/`while`/`&&`/`||`/`!` — not just the top-level call. `if ! my_func "$x"; then ...` does NOT make a failing command inside my_func abort or short-circuit; every line still runs, and the return code is whatever the LAST command happened to exit with. Every risky command inside such a function must be individually guarded with `|| return 1`. This is what let TAL-001's bootstrap survive per-repo failures by accident (its repair paths were separately guarded) but let TAL-002's first draft break silently — a for-loop calling a function under `if !` to preserve loop continuation needs this on every internal command.

Related: [[per-item-loop-three-default-cases]] [[shell-test-vitest-path-shims]]
