---
tags: [git, concurrency, push]
paths: ["**"]
strength: 1
source: "PR#101 (TAL-012) dev retro"
graduated: false
created: 2026-07-18
---

When a push reveals unexpected commits already on origin for a branch you're pushing, diff content before touching history (git diff origin/branch HEAD -- <your files>) rather than assuming conflict/panicking or blindly force-pushing. A zero-diff result on your own files means it's safe to reset to origin and continue -- no escalation needed.
