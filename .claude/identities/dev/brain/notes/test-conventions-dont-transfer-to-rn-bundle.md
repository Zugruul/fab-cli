---
tags: [react-native, metro, imports]
paths: ["fab-app/**"]
strength: 1
source: "PR#248 APP-024 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

A convention from a __tests__/ file NEVER transfers to code reachable from App.tsx without a bundler check: tsc AND jest both happily accept node:-prefixed imports that Metro cannot resolve at runtime. Before using any API in shippable RN code: grep fab-app/src production code for precedent; none found -> confirm it is a documented RN-provided global (setUpPerformance.js etc.), not a bare Node builtin. PR#248: bare global performance.now() (RN + Node>=16 both provide it) over node:perf_hooks.

Related: [[read-producers-real-bytes-before-fixtures]]
