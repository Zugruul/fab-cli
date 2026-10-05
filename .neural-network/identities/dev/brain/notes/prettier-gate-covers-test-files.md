---
tags: [gate, prettier, testing]
paths: ["test/**"]
strength: 1
source: "PR#89 (TAL-001) red gate 04:49 lessons.jsonl"
graduated: false
created: 2026-07-18
---

The format:check gate runs prettier over test/ too — hand-written template-literal-heavy test files nearly always fail it. Run `npx prettier --write` on new/edited test files before the gate instead of hand-formatting.
