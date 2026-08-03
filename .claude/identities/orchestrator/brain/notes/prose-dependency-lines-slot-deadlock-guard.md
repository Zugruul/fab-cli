---
tags: [board, dependencies, slots]
paths: ["**"]
strength: 1
source: ""
confidence: direct
learned-from: loop close 2026-08-03
graduated: false
created: 2026-08-03
last-touched: 2026-08-03
---

The pick script ranks by priority + epic sequencing and CANNOT see prose "Depends:" lines in backlog rows — the orchestrator's pre-brief read of the authoritative backlog row is the only guard. When the scripted pick's dependency is unmet AND starting it would park a slot on a human gate while another slot is already human-parked, that's a slot deadlock in the making (all WIP parked = loop stalls). Correct move: document the conflict on the picked issue, ADOPT the unmet dependency task instead (it's the highest-leverage unblocked work by construction), and state the deviation on both issues. Never start a task whose acceptance criteria are physically unachievable now just because the script offered it.
