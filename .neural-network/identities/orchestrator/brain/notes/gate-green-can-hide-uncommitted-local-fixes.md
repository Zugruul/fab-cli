---
tags: [gate, verification, prettier]
paths: ["**"]
strength: 1
source: "PR#97 (FAB-022) merge — gate red on merged main"
graduated: false
created: 2026-07-18
---

A dev agent's self-reported 'gate green, format clean' can be stale/inaccurate even when the reported test count is real — on PR#97 (FAB-022), the agent's own final fix commit had a genuine prettier formatting violation in the same file it had just edited, yet reported format:check clean. The orchestrator's own re-run of gate.sh (before merge) somehow didn't catch it either — traced to an uncommitted local prettier --write having silently 'fixed' the working tree without a corresponding commit, so the orchestrator's pre-merge gate run was green against a DIFFERENT (locally-patched) tree than what was actually in the commit that got merged. Discovered only when re-running the gate fresh on merged main.

Related: [[reproduce-gate-claims]] [[scoped-green-verification]]
