---
tags: [briefing, durability, skill-files]
paths: [".claude/skills/**"]
strength: 1
source: "PR#112 (TAL-022) dev retro"
graduated: false
created: 2026-07-18
---

When the correct check flips a 'missing' assumption to 'already exists' and the task becomes a no-op, that's not a signal to just skip work and report the finding -- it's a signal to encode the CHECK ITSELF into the durable artifact (a skill file, a script, a test) so the next agent or the next instance of the same problem gets the discriminator, not just this session's one-off narrated finding. A 'nothing to do' outcome only counts as truly done once the mechanism that decided 'nothing to do' is durable, not merely narrated in a PR body.
