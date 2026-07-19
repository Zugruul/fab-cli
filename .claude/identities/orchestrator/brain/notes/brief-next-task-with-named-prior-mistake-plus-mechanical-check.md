---
tags: [briefing, process, orchestration]
paths: ["**"]
strength: 1
source: "PR#115 (TAL-031) loop-feedback"
graduated: false
created: 2026-07-19
---

When a process mistake occurs in one task and the same class of task will run again soon in the same session, brief the next instance with the SPECIFIC failure mode named explicitly (not just 'remember to do TDD properly') plus a concrete, mechanical self-verification step the agent can run itself before proceeding (e.g. 'after your first commit, run git show --stat and confirm it shows ONLY the test file'). A generic reminder of the rule is less effective than naming the exact way it was violated last time and giving a literal command to check against recurrence. Confirmed working: the very next task avoided the exact mistake the prior task made, independently verified by two reviewers.
