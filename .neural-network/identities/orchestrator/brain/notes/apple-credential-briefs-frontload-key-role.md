---
tags: [briefing, credentials, apple]
paths: ["**"]
strength: 1
source: ""
confidence: direct
learned-from: task 144
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

When briefing a task on Apple/ASC credentials, the key's ROLE (ASC → Users and Access → Integrations) and the Team ID are load-bearing facts, not niceties — #144 stalled precisely on an unverified role (App Manager insufficient for cloud signing) after the Team ID had to be self-resolved mid-task. Front-load both in the brief (ask the human to confirm the role when the key is handed over), alongside key id/issuer/path. Generalizes: for any vendor credential, brief the PERMISSION LEVEL actually verified, not just the credential's location.
