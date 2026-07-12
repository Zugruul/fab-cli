---
tags: [skills, consult, read-only, human-in-the-loop, protocol]
paths: []
strength: 1
source: "loop-feedback 2026-07-12"
graduated: false
created: 2026-07-12
---

Read-only consult skills (ask a brain a question, no writes) can collide with a direct human instruction to change the consulted role's behavior mid-consult. The skill's no-write rule protects against AGENT-initiated mutation, not against the human's explicit direction — when the human directs a protocol/behavior change during a consult, hand off to the orchestrator-level edit path (edit the role's protocol note as orchestrator, commit under the orchestrator identity) rather than refusing or silently ignoring the skill's letter. Note the handoff explicitly in the reply so the boundary stays legible. Cf. [[human-validation-confidence-loop]].
