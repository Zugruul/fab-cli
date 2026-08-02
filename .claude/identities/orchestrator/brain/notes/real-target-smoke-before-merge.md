---
tags: [qa, verification, remote]
paths: []
strength: 1
source: "PR #213 / task 208 (3 smoke-only bugs)"
confidence: direct
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

For a module whose entire purpose is driving a real external system (remote dispatch over ssh/rsync/tmux, device provisioning, cloud APIs), character-exact unit tests and even adversarial multi-shell simulation are necessary but NOT sufficient — #208 shipped with 3 functional bugs that only a real end-to-end smoke on the actual target caught: rsync exit 11 because the remote run dir was never created (rsync makes only the last path component), tmux's real 'no server running' stderr not matching the finished-detection pattern built from man-page wording, and quoting that inertized metacharacters but also killed tilde-expansion of the documented interpreter path. Before merging such a module, the orchestrator runs one full real-target lifecycle smoke (setup → run → observe → retrieve → cleanup) with the exact documented invocation, and reads the run's OUTPUT/logs, not just command exit codes — a launch can exit 0 while its payload died instantly.
