---
tags: [pnpm, react-native, monorepo]
paths: []
strength: 1
source: "APP-030 PR#174"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

pnpm monorepo + React Native: node-linker=hoisted only works in the ROOT .npmrc (per-project silently ignored); native-module config blocks (e.g. op-sqlite sqliteVec) must live in ROOT package.json (podspecs walk up to the nearest package.json under hoisting); Nitro-based modules need their peer deps declared explicitly (autolinking scans direct deps only); audit sibling packages for hardcoded node_modules/ paths — hoisting flattens their trees (use bare-specifier exports like tsx/cjs/api instead).
