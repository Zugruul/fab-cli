---
tags: [review, commits, brains, content-seeding]
paths: ["**"]
strength: 1
source: "PR#102 (TAL-013) code-quality review"
graduated: false
created: 2026-07-18
---

For knowledge-content seeding tasks (brain notes minted from one research pass, e.g. FAB-033/TAL-013's model), don't demand commit splitting the way you would for application code -- one commit per logical unit of content (a full batch minted together) is the right granularity. Instead scrutinize whether the accompanying test asserts on note BODY TEXT (forces real distillation, a stub can't pass) rather than just file existence (a stub could satisfy).
