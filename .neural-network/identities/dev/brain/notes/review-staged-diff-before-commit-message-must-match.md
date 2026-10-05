---
tags: [git, commits, hygiene]
paths: ["**"]
strength: 1
source: ""
learned-from: task 217 commit a87bebe4
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Two commit-hygiene failures in one #217 commit (a87bebe4): (1) earlier-staged unrelated changes silently rode along with a one-line fix, so the commit message undersells its diff (hurts bisectability and review); (2) the committed file content differed from what had just passed the in-session gate (a pt-BR key silently missing) — caught only by re-running the gate against HEAD after committing, not trusting the pre-commit run. Before EVERY commit: `git diff --staged --stat` and confirm the staged set is exactly the current logical change and the message describes all of it; after committing, verify against HEAD (gate or targeted tests), because the working tree ≠ what got committed if anything touched files in between.
