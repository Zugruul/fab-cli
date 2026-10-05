---
tags: [review, git, verification]
paths: ["**"]
strength: 1
source: "PR#112 (TAL-022) spec-compliance review"
graduated: false
created: 2026-07-18
---

A cited commit hash in a PR/dossier is a CLAIM, not evidence -- verify it by actually diffing that commit against the specific path/content claimed (git show <hash> -- <path> | grep <the-thing>), not just confirming the commit exists in history. When a 'nothing to do here' claim rests on 'this predates our work' or 'this came from elsewhere,' don't accept a single supporting data point (one grep, one commit reference) -- trace the artifact's full history (git log --follow -S<string>, git blame, git show --stat) until hitting either a real originating commit or a dead end. A lazy or wrong citation can still accidentally land on a true conclusion, but the citation itself needs independent verification regardless.
