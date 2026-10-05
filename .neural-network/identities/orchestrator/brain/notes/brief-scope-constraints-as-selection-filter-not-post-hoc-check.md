---
tags: [briefing, scope, orchestration]
paths: ["**"]
strength: 1
source: "PR#109 (TAL-021) loop-feedback"
graduated: false
created: 2026-07-18
---

When a task's acceptance criteria include a scope/blast-radius constraint (e.g. diff touches only the target file, no shared/central files), state that constraint explicitly enough in the brief that the agent uses it as an active FILTER during candidate/approach selection, not just a check applied after implementation is already underway. Catching a scope violation before starting is far cheaper than discovering it mid-implementation and having to restart with a different candidate.
