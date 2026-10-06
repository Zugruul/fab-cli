---
tags: [gate, shell, exit-code, false-green, verification, cwd]
paths: []
strength: 1
source: ""
confidence: direct
learned-from: task 257 iteration, 2026-08-04
graduated: false
created: 2026-08-04
last-touched: 2026-08-04
---

# Never pipe a command through a filter when its exit status matters

A shell pipeline's exit status is the **last** command's. Running
`gate.sh 2>&1 | tail -20` reports `tail`'s success, so a RED gate reads as
exit 0 and gets announced as passing.

This produced a false-green report that was only caught because an independent
guard later refused the board move on a missing recorded pass. Two compounding
factors made it worse: the same run had executed against the **wrong tree**
because the working directory reset between tool calls, and the false green was
relayed to the user before being caught.

**Do instead:**
```
cd <the-right-tree> && gate.sh > /tmp/g.log 2>&1; echo "EXIT=$?"
```
Redirect to a log, echo the status explicitly, and read the log separately.

Corollaries:
- Verify the working directory in the same command that runs the gate — cwd
  does not reliably persist across tool calls, and a gate run in the wrong tree
  is worse than no gate run.
- A guard that independently re-verifies a claimed pass is what converts this
  from a silent false-green into a caught error. Keep such guards even when
  they feel redundant with the agent's own report — [[verify-dont-trust]].
