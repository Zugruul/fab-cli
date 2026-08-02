---
tags: [state-machines, resources, error-handling]
paths: []
strength: 1
source: "APP-034 PR#197 review"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Failure paths in resource-owning state machines must ALWAYS land on a retryable state and ALWAYS release the resource, even when the persistence step fails: catch each risky operation independently, attempt all of them regardless of earlier failures, null the resource reference unconditionally, and record every failure observably in the transition details. A guard like state!=='loaded' return silently turns one thrown save into a permanent wedge + double-minted native resources. Prefer losing recoverable state (a session) over leaking unrecoverable resources (a native context).
