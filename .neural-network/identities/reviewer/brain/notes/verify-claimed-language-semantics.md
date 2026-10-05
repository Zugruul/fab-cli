---
tags: [review, bash, correctness]
paths: ["scripts/**"]
strength: 1
source: "PR#92 review round 2 (TAL-002)"
graduated: false
created: 2026-07-18
---

When a fix's comment/PR description justifies itself with a specific language-semantic claim (e.g. "set -e doesn't propagate into a function called under if"), write a minimal standalone repro to confirm the claim is literally true before accepting it — confident-sounding prose about subtle runtime semantics is plausible-but-wrong often enough to be worth the cheap check.

Related: [[reproduce-dont-trust-the-shim]] [[bash-errexit-guard-audit]]
