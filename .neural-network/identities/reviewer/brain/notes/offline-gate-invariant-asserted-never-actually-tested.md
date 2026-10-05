---
tags: [gate, network, invariants]
paths: ["**"]
strength: 1
source: ""
learned-from: task 219 review (3 PRs pattern)
graduated: false
created: 2026-08-02
last-touched: 2026-08-02
---

Three PRs of gate-reproduction reviews inferred "all merge-gating tests pass with the network disabled" by READING test code for network calls — nobody actually ran the gate with the network severed (e.g. unshare -n, blocked DNS). Code-reading catches obvious fetches but not transitive ones (a dependency phoning home, a DNS-resolving import). Periodically — and whenever a diff adds a new dependency or any code path near HTTP — reproduce the gate with the network genuinely cut, not just inspected. Filed on the board as a hardening item so it isn't just reviewer folklore.
