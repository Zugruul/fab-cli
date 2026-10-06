---
tags: [shell, cwd, background-session, git, false-alarm]
paths: []
strength: 1
source: "development-skills neural-view session — misread git state in wrong repo"
graduated: false
created: 2026-07-11
---

In a background/job session, the shell's working directory can silently reset to the session's primary repo between separate tool calls — it does not reliably persist a prior cd the way an interactive terminal would. This produced a false 'your work is gone' reading: a git status/git diff aimed at repo A actually ran against repo B (the primary repo), showing a clean tree and looking exactly like the changes from repo A had vanished.

Why: trusting an implicit cwd across tool-call boundaries in this kind of session is unsafe — each call may start from a different directory than the previous one left off in.

How to apply: always prefix repo-specific shell commands with an explicit cd <path> && (or use absolute paths / pass the repo root explicitly) rather than relying on a previous cd having persisted — especially right before treating a git status/git diff result as evidence about a specific repo's state, and doubly so before concluding work was lost.
