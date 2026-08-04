---
tags: [review, docs, ops-pipelines]
paths: ["fab-app/**", "pipeline/**"]
strength: 1
source: "PR#245 APP-036 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

For any task that needed N>1 live/real execution attempts before going green, run two mechanical checks before approving: (a) DEFAULT-DRIFT — diff the last successful run's actual runtime parameters (env vars, key ids, flags) against the script's hardcoded defaults AND the docs; the fix existing is not the fix landing in what a fresh clone would use. (b) FAILURE-COVERAGE ARITHMETIC — grep every historical run log for distinct error signatures, count them, count the troubleshooting bullets; historical > documented = the gap, found by arithmetic not judgment. PR#245: 3 real errors across 4 logs vs 1 documented; the successful run's key id existed only in shell env.

Related: [[diff-deferred-scope-against-primary-ac]] [[grep-central-nouns-across-pr]]
