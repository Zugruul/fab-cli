---
tags: [review, testing, shims]
paths: ["test/**"]
strength: 1
source: "PR#92 review rounds 1-2 (TAL-002)"
graduated: false
created: 2026-07-18
---

Build your OWN fake-git/shim harness from scratch to reproduce a suspected bug, rather than trusting the dev's fixture — a shim shaped by the dev can make the dev's own tests pass without proving the underlying property. Independent reproduction is what turns "plausible from inspection" into "verified," and round 2 is what lets you say PASS with real confidence instead of "their new tests pass." Also: treat a shim capability nobody's test exercises (e.g. a fail-state branch with zero callers) as a first-class finding — that's exactly where bugs hide.

Related: [[verify-red-commit-by-running-it]] [[verify-claimed-language-semantics]]
