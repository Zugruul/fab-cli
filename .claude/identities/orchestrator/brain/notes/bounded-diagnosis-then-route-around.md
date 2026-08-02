---
tags: [debugging, process, integration]
paths: []
strength: 1
source: "PR #220 / bug #221 (llama-cli smoke)"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Live-debugging third-party infrastructure needs a stop rule: vary ONE variable per probe (build version, flag form, input via file vs inline, stdin state, alternate binary), and once N≈5 independent probes all isolate the failure to the environment/upstream layer — not your code — STOP, file the bug with the complete probe trail (each probe + its observation is a sentence), and route around it. On the llama-cli smoke: 8 probes proved schema→grammar throws across three independent builds and EOF busy-loops the REPL; the fix-forward was a P1 bug with the trail plus shipping with the OPTIONAL smoke section omitted — possible only because the feature was designed as optional/backward-compatible from the start. Twin lesson: make risky integrations optional config sections, so an environment defect degrades one feature instead of blocking the chain.
