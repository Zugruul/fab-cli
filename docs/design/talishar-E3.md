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

## TAL-031 — Bug + DX scan, findings filed as tasks

Grounded in: SPEC-TALISHAR.md §9.2, §9.3, §9.4.

### Components

- `docs/TALISHAR-AUDIT.md` (already merged, TAL-030) — extended with two new `##` sections:
  "Bug scan" and "DX" (developer experience). Same document, additive change only — TAL-030's
  five performance sections are untouched.
- New board task(s) for the top-ranked findings — filed via the `create-inbound` flow. **This is
  the ORCHESTRATOR's job, not the dev agent's** (dev agents never touch the board, per this
  workflow's standing rule) — the dev agent's deliverable is the audit content PLUS a clearly
  ranked list of which findings should become board tasks and why; the orchestrator files them
  as a follow-up step after reviewing the PR, using the dev agent's proposed title/body text
  as a starting draft, per the same `create-inbound` dedup-search process already used for
  TAL-024.

### Interfaces / contracts

- **Bug scan (§9.2)**: triage upstream `Talishar/Talishar` issue history (read-only —
  `gh issue list --repo Talishar/Talishar --state closed --search "..."` etc.) for recurring bug
  CLASSES, using the spec's named seeds as starting points (BE #501 SSE disconnect, #183 lag
  double-activation, FE #98 reload freeze) — confirm these are real issues first
  (`gh issue view <n> --repo Talishar/Talishar`), don't assume the spec's examples are still
  accurate without checking. Then scan the VENDORED code (the same clone already used throughout
  E1-E3) for reproducible suspects matching those bug classes — a real code location that could
  plausibly cause the same symptom, cited by path.
- **DX section (§9.3)**: friction in local setup (real, lived experience from this session's own
  `bash start.sh` runs across TAL-023/024/030), test coverage gaps (in the vendored PHP codebase's
  own test suite, if any exists — check), stale docs (beyond the `port 8000` and `CardImages` URL
  gotchas TAL-010/011 already found and documented — look for NEW stale-doc findings, don't just
  repeat those). Each DX item needs a concrete improvement proposal, not just a complaint.
- **§9.4 (filing)**: "top-ranked findings" — not every finding needs a board task, only the
  highest-impact ones (dev agent's judgment on the cutoff, but should be a deliberate cut, not
  "all of them" or "none of them"). Each filed task must be "independently actionable" (§9.4's
  literal AC) — a human or a future dev agent picking it up shouldn't need to re-read the whole
  audit doc to understand the task; the task's own body should be self-contained (what/why/where),
  linking back to the audit doc section for full context, not substituting for it.
- Same doc-task-adapted TDD as TAL-030: a structural test asserting the two new sections exist
  with the required finding shape (evidence/impact/proposal, or explicit "no issue found"),
  extending `test/talishar-audit-doc.test.ts` (same file, not a new one — TAL-030's test already
  has a negative check that these sections are ABSENT, which needs updating to assert they're
  PRESENT with the right shape once this task lands) OR a new dedicated test file — dev agent's
  call, but don't leave TAL-030's stale negative-check assertion in place unmodified (it would
  fail once this task's sections exist, or worse, silently stop meaning anything if it's just
  deleted without replacement).

### Key sequences

1. Read `docs/TALISHAR-AUDIT.md` (merged) in full for context/format precedent.
2. Bug scan: verify the spec's seed issues are real (`gh issue view`), find their actual
   root-cause discussion if referenced/linked, then grep the vendored engine for code matching
   that bug CLASS (not necessarily the exact same bug if already fixed — the class of mistake).
3. DX scan: draw on this session's own real experience (docker bring-up friction, submodule-init
   gotchas already captured in brain notes, etc.) plus fresh code/doc reading for anything new.
4. Write the two new sections into `docs/TALISHAR-AUDIT.md`.
5. Update/extend the structural test.
6. Propose a ranked cut of findings to file as board tasks — draft title + self-contained body
   for each, in the PR description, for the orchestrator to review and file post-merge.

### Decisions

- **Board-task filing happens AFTER PR review/merge, by the orchestrator**, not by the dev agent
  mid-task — keeps the "dev agents never touch the board" rule intact while still satisfying
  §9.4's requirement that findings become real, actionable board tasks.
- **Reuse `test/talishar-audit-doc.test.ts`** rather than fragmenting audit-doc testing across
  multiple files, unless the dev agent has a good reason to split it.

## TAL-032 — Fix equipment/card double-activation under lag (BE #183 regression)

Grounded in: TAL-031's finding (`docs/TALISHAR-AUDIT.md`, "BE #183" subsection, PR #115), upstream
`Talishar/Talishar#183`, SPEC-TALISHAR.md §10 I1/I2/I4.

### Components

- `third_party/talishar/ProcessInput.php` — backend request handler, needs to validate
  `expectedRevision`/`commandId` (currently reads neither, per TAL-031's zero-match grep).
- `third_party/talishar-fe/src/routes/game/components/elements/playerHandCard/PlayerHandCard.tsx`
  — `playCardFunc` needs to gate on `isPlayerInputInProgress`.
- 8 equipment/hero/arsenal zone components (`WeaponRZone`, `ChestEqZone`, `ArmsEqZone`,
  `LegsEqZone`, `HeadEqZone`, `WeaponLZone`, `HeroZone`, `ArsenalZone`) — need
  `preventUseOnClick={isPlayerInputInProgress}` wired into their `<CardDisplay>` calls, matching
  the pattern already used by `GraveyardZone`/`BanishZone`/`PitchZone`/`OtherInput`.

### Interfaces / contracts

- **Blast radius is real and must be respected**: `ProcessInput.php` is the single dispatch point
  for EVERY card action in the engine, not just equipment. A validation change here is much
  higher-risk than a single card's `Card` subclass — it must not reject legitimate, already-working
  request patterns (e.g. a genuinely-first request for a fresh gamestate, or requests from card
  types/flows that don't yet send `expectedRevision`/`commandId` at all, if any exist beyond
  `playCard`/`submitButton`/the third `GameSlice.ts` thunk TAL-031 found).
- **Research before touching the shared file**: before writing the validation logic, grep
  `third_party/talishar-fe/src` for EVERY caller that sends `expectedRevision`/`commandId` (TAL-031
  found 3 call sites in `GameSlice.ts` — confirm that's still the complete set) and every
  `ProcessInput.php` caller pattern that does NOT send them, so the backend validation degrades
  gracefully (skip the check, don't reject) for any request shape that legitimately omits these
  fields rather than treating their absence as automatically invalid.
- **§10 I4**: derive the exact validation semantics from the upstream issue's own discussion
  (`gh issue view 183 --repo Talishar/Talishar`) plus the real current code shape — don't invent
  a generic "reject stale revisions" rule without confirming it matches how `lastUpdate`/gamestate
  revisioning actually works elsewhere in the engine (check `GetUpdateSSE.php`'s cache-counter
  mechanism, already documented in TAL-013's `tal-arch-gamefile-lifecycle` brain note, for the
  existing revision-tracking convention to stay consistent with).
- **Validation via the docker stack (same pattern as TAL-023)**: bring up the local stack, exercise
  a normal single-click card play (must still work, unaffected) AND a deliberate rapid-double-click
  reproduction of the original bug (must now be correctly suppressed/rejected) for at least one
  equipment card and one hand card.
- **§10 I1/I2**: same as TAL-021/023 — implement on local branches of the vendored clones' own
  forks, validate, and STOP before pushing to ask the orchestrator/human explicitly (this is a
  NEW instance of the fork-push action class, not covered by any earlier session consent for a
  different task — needs its own explicit check per this session's own established practice).

### Key sequences

1. Re-read TAL-031's finding in full (`docs/TALISHAR-AUDIT.md`'s "BE #183" section) plus the
   upstream issue thread.
2. Map every caller of `expectedRevision`/`commandId` (FE) and every code path through
   `ProcessInput.php` (BE) that would be affected by adding validation — confirm the full
   blast radius before writing a single line.
3. Implement the BE validation (reject stale `expectedRevision` and/or dedupe by `commandId`) on a
   local branch of `third_party/talishar`.
4. Implement the FE gating (`isPlayerInputInProgress` check in `PlayerHandCard.tsx`,
   `preventUseOnClick` wiring in the 8 zone components) on a local branch of
   `third_party/talishar-fe`.
5. Validate via the docker stack: normal play still works; rapid double-click no longer
   double-activates.
6. STOP before pushing anywhere — report readiness and wait for explicit push authorization,
   same as TAL-023's pattern.

### Decisions

- **This is a genuine bug fix, not a new-card exercise** — unlike TAL-021, there's no "dossier"
  phase; the research phase here is understanding the existing request-validation surface, not a
  card's true text.
- **Fork-push for this task needs its own fresh consent**, even though the user already authorized
  continuing into TAL-032 generally — per this session's own established practice (and a retro
  lesson minted from TAL-023), a consent to "do the work" doesn't automatically cover "push to an
  external fork," which is asked separately when that point is actually reached.

## Out of scope for this epic-task

- TAL-033 (PHPUnit smoke-test coverage) — separate task, tracked independently.
