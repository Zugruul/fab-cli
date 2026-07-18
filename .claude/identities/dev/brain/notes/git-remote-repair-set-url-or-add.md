---
tags: [bash, git, vendoring]
paths: ["scripts/**"]
strength: 1
source: "PR#89 review round 1 (TAL-001)"
graduated: false
created: 2026-07-18
---

Real git `remote set-url <name> <url>` can only retarget an existing remote — it errors if the remote was never added. Any repair/self-heal path must be `set-url ... || remote add ...`, applied to every remote it manages (origin AND upstream). The happy path never exercises this, so only a faithful test double catches it.

Related: [[shell-test-vitest-path-shims]]
