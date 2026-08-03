---
tags: [review, static-guards, determinism]
paths: ["pipeline/**"]
strength: 1
source: "PR#238 APP-026 retro"
confidence: direct
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

Regex-over-source-text guards (rng/determinism tripwires) need a fresh EMPIRICAL evasion pass at every review — run actual evasion strings through the guard, never reason about the regex in your head. Each hardening round plugs specific holes without closing the class: aliasing passed round 1, destructuring (const {random} = Math) still passed round 2's hardened version. Also: such guards false-positive on their own doc comments unless they strip comments first. Closing the class properly = AST lint, a deliberate tooling decision.

Related: [[prefix-swapback-verification]] [[compute-edge-frequency-from-config]]
