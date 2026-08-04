---
tags: [review, credentials, preflight]
paths: ["fab-app/**"]
strength: 1
source: "PR#245 APP-036 retro"
confidence: direct
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

For credential-gated pipelines, ask whether preflight checks EXISTENCE (key file present) or the actual PERMISSION the expensive step needs (key role sufficient for cloud signing). The gap between those is exactly where a 10-30 min cycle burns: PR#245's check-env passed while the App-Manager key was doomed to fail at export. A preflight-role probe needs a live API call — weigh that cost against the cycle it saves.

Related: [[execute-load-bearing-mechanism-claims]]
