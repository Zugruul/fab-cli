---
tags: [eval, release-gate, pipeline]
paths: ["pipeline/**"]
strength: 1
source: ""
learned-from: task 134
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

For APP-023 (release-gate policy) and later E2 work on top of the eval harness: gate.ts's checkGate() already returns raw {breaches, regressions, passed} — consume it, never reimplement threshold math. Thresholds/penalties live in pipeline/config/eval-harness.json, loaded+validated by assertValidGateConfig (runtime-checks incorrect≫abstain asymmetry + full 8-suite coverage) — reuse that loader. Explicitly NOT built by APP-022: the major-version human-audited-sample-review step (§8.5 second clause) and real model-client wiring (cli.ts --real throws; deferred on remote compute). No real eval-run/calibration artifacts are committed anywhere (gitignored, regenerable) — the first real gate run starts genuinely fresh.
