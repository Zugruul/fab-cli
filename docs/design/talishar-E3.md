# Design — talishar/E3: Latency, bug & DX audit

Grounded in: SPEC-TALISHAR.md §9.1–§9.5, §10 I6.

## TAL-030 — Latency/performance audit → docs/TALISHAR-AUDIT.md

### Components

- `docs/TALISHAR-AUDIT.md` — a new document, structured as one section per audited area, each
  section containing findings in the shape §9.1a requires.
- No new fab-cli source files — this is a pure audit/documentation task, same pattern as TAL-010
  (deep architecture doc). Reuses the same citation discipline (§7.1a-style: every claim cites a
  vendored path) already established for `docs/TALISHAR-ARCHITECTURE.md`.

### Interfaces / contracts

- **Audited areas (§9.1, all required, minimum)**:
  1. SSE update path — full-gamestate payload size vs board complexity; serialization cost in
     `BuildGameState.php`.
  2. Gamestate caching — APCu/Redis usage (already partially documented in TAL-013's
     `tal-arch-gamefile-lifecycle` brain note — cite and extend, don't re-derive from scratch).
  3. Apache/SSE tuning — `apache-performance.conf` (gzip, worker headroom — also touched by
     TAL-013's notes).
  4. FE parse/render cost — `ParseGameState.ts` → Redux (`GameSlice`).
  5. File-I/O of the GameFile cycle — read/write/lock behavior (also covered architecturally by
     TAL-013's `tal-arch-gamefile-lifecycle`, but this audit's job is PERFORMANCE characteristics,
     not just the mechanism).
- **Finding shape (§9.1a, every finding)**: evidence (file paths + measurements from the local
  stack WHERE OBTAINABLE), user-visible impact, an upstream-friendly fix sketch, an effort/impact
  rank (e.g. a simple High/Medium/Low × High/Medium/Low grid, or a numeric score — dev agent's
  call on the exact scale, consistency across findings matters more than the specific scale
  chosen).
- **AC (literal, from the backlog)**: every audited area has ≥1 evidence-backed finding OR an
  explicit "no issue found" — an area is never silently skipped. Findings are ranked (relative
  priority visible, not just individually rated). Nothing is added to the gate (§10 I6 — this task
  produces a doc, not a test; `npm run gate` must stay exactly as green/red as it was before this
  task, no new dependency introduced).
- **§9.5**: stack measurements (actually running the docker stack, timing real API responses,
  measuring real SSE payload sizes) are explicitly OPTIONAL for this task — "user-invoked
  sessions." A finding grounded in STATIC evidence (reading `BuildGameState.php`'s serialization
  logic, counting fields, reading `apache-performance.conf`'s actual directives) is a complete,
  valid finding on its own. If the dev agent DOES bring up the docker stack for a real
  measurement, that's a bonus (stronger evidence), not a requirement — and per the established
  pattern from TAL-023, bringing up the LOCAL stack for read-only measurement (no push, no
  external write) doesn't need a fresh consent round the way a fork-push did; it's the same class
  of local-only, reversible action already exercised.

### Key sequences

1. Read `docs/TALISHAR-ARCHITECTURE.md` and TAL-013's relevant `tal-arch-*` brain notes first —
   don't re-derive already-documented mechanism; the AUDIT's job is to add a performance lens on
   top of the architecture that's already described.
2. For each of the 5 areas, study the relevant vendored source directly for concrete,
   measurable-or-estimable characteristics (a field count, a payload size estimate from the
   `BuildGameState.php` structure, a cache TTL/size setting, a known N+1-shaped loop, etc.).
3. Where a real number is obtainable without excessive effort (e.g. `wc -c` on a saved SSE payload
   from a real local game, or a `time` on a real API call) via the local docker stack, get the
   real number — but don't block the whole task on infrastructure friction; a well-reasoned
   static estimate with clearly-stated assumptions is an acceptable fallback per §9.5.
4. Write findings in the required shape; rank them.
5. `npm run gate` — confirm it's exactly as green as before this task started (this task adds a
   markdown file only, so this should be trivially true, but confirm rather than assume).

### Decisions

- **This task does NOT write TAL-031's bug-scan/DX sections** — those are a separate task
  (§9.2-9.4), even though they land in the same `docs/TALISHAR-AUDIT.md` file eventually. TAL-030
  creates the file with ONLY the performance/latency sections; TAL-031 extends it.
- **A static, well-reasoned estimate is an acceptable finding when live measurement isn't
  practical in an autonomous session** — §9.5 explicitly frees this task from requiring the
  running stack. Don't let infrastructure friction block the whole task; note explicitly in each
  such finding that it's an estimate, not a measured number, and what would be needed to measure
  it for real.

## Out of scope for this epic-task

- TAL-031 (bug-scan + DX sections, same file, separate task).
