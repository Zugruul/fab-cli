---
tags: [research, grep, verification]
paths: ["**"]
strength: 1
source: "PR#115 (TAL-031) dev retro"
graduated: false
created: 2026-07-19
---

A 'zero matches' grep result is a claim about your PATTERN, not about the codebase. Before writing 'X is unused'/'X doesn't exist' into any finding or note, re-run with a deliberately looser variant (drop trailing '=', quotes, anchors) and confirm the count doesn't change. A pattern with a trailing '=' silently excludes JSX shorthand boolean prop syntax (<Foo bar /> has no '='); this exact mistake produced a false 'dead plumbing' finding that a looser grep immediately contradicted (5 real callers). When a negative claim turns out to be fully false (not just overstated), retract it entirely rather than defending a softened version -- a weakened claim is still an unverified claim with gentler language, not a fix.
