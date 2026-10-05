---
tags: [testing, licensing, pnpm]
paths: []
strength: 1
source: "APP-004 PR#168 review minor"
confidence: direct
graduated: false
created: 2026-08-01
last-touched: 2026-08-01
---

Dependency-isolation tests must scan dependency VALUES as well as keys: pnpm/npm aliasing (alias: npm:real-pkg@spec) and link:/file: specs let a forbidden package hide under any key, so Object.keys checks give false confidence. Iterate Object.entries across all four dependency fields and match the forbidden package names/paths in both name and spec string. Instance of the general rule: ask what buggy implementation would still pass this test.
