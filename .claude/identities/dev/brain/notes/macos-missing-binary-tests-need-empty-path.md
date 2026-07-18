---
tags: [testing, macos, bash]
paths: ["test/**"]
strength: 1
source: "PR#89 (TAL-001) dev retro"
graduated: false
created: 2026-07-18
---

macOS ships a /usr/bin/git stub (Xcode CLT trigger) that makes `command -v git` succeed even with no real git installed. Never test "binary X missing" by pointing PATH at system dirs — use an empty/synthetic PATH and invoke the interpreter by absolute path (/bin/bash).

Related: [[shell-test-vitest-path-shims]]
