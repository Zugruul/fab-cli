---
tags: [metrics, pipelines, testing]
paths: []
strength: 1
source: "APP-012 PR#179 review"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Any logged quality metric (acceptance rate, pass rate, accuracy) must structurally separate infrastructure failures from genuine quality signals — a flat rejected bucket lets an API outage masquerade as bad data and poisons trend analysis. Tag outcomes with a kind field at the branch that produced them (the code always knows), roll separate counts into the persisted summary, compute the quality rate excluding infra failures, and keep the raw rate alongside so the outage stays visible. Prove it with an outage-simulation test asserting exact fractions.
