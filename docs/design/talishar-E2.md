# Design — talishar/E2: Card implementation pipeline

Grounded in: SPEC-TALISHAR.md §5, §8.1–§8.7, §10 I1, I2, I3, I4.

## Components

- `.claude/skills/talishar-implement-card/SKILL.md` — the `/talishar-implement-card <card name or
  set-code>` skill, orchestrating four phases (dossier → implementation → images → validation +
  hand-off). Follows the `talishar-fork-sync` skill's format (front-matter `name`/`description`,
  "Standing invariants" section restating I1–I4 verbatim, numbered "Steps").
- **TAL-020 (this task): the dossier phase only.** A dossier-assembly procedure (documented in the
  skill file, backed by a small helper script if the assembly logic is non-trivial enough to
  warrant one — see Decisions) that gathers, for a given card:
  - Live Card Vault true text + rulings via `fab-cli fabtcg card "<name>"`.
  - the-fab-cube stats via `fab-cli fabrary cards local --exact "<name>"` (the same
    `third_party/flesh-and-blood-cards` dataset Talishar's own `zzCardCodeGenerator.php`
    consumes).
  - Fabrary context (deck/meta usage) where it adds implementation-relevant signal — e.g. is this
    a commonly-played card, does it have known interaction complexity — via
    `fab-cli fabrary cards search`.
  - talishar-brain recall of matching implementation patterns: `brain.sh recall talishar
    --keywords "<archetype/pattern terms>"` against the notes TAL-013 seeded (modal, ClassState
    counter, windup, combat-modifier patterns) to find the closest existing recipe.
  - The card's official image reference (a link/identifier, not a downloaded file — actual image
    processing is TAL-022's job).
  - A persisted **dossier file** (see Data models) so later phases (TAL-021/022/023, or a resumed
    session) consume it without redoing research.
- `docs/design/talishar-E2.md` (this file) — the epic design doc TAL-021/022/023 will extend with
  their own sections, same pattern as `talishar-E1.md`.

## Data models

**Dossier** — persisted as a single markdown file per in-progress card implementation, e.g.
`.claude/talishar/dossiers/<card-slug>.md` (gitignored working state, NOT committed to fab-cli —
this is ephemeral session state for an in-progress upstream contribution, not a knowledge artifact;
add `.claude/talishar/dossiers/` to `.gitignore`). Shape:

```markdown
# Dossier: <Card Name> (<SET><number>)

## Status
<dossier | implementing | images | validating | ready-for-pr | blocked: <reason>>

## Card Vault true text
<verbatim TRUE text from `fab-cli fabtcg card`, with the cardvault URL>

## Rulings / errata
<any rulings_errata entries>

## the-fab-cube stats
<stats block, OR "GAP: not yet in dataset" per §8.1a>

## Fabrary context
<brief usage/meta note, or "no notable usage data" if the card is new>

## Similar existing implementation(s)
<1+ vendored card class(es) found via brain recall, cited by path, with a one-line note on why
it's the closest pattern match — e.g. "modal ClassState-gated, see
`tal-recipe-classstate-counter` / `tal-recipe-modal-choose1`">

## Official image reference
<link/identifier>

## Dataset gap (if applicable, §8.1a)
<IF the card isn't in third_party/flesh-and-blood-cards yet: record it here, note that
zzCardCodeGenerator.php output needs regeneration once the dataset catches up, and derive stats
from Card Vault/spoilers instead>
```

This shape is deliberately plain markdown (not JSON/YAML) — the dossier is a human-and-agent-
readable working document that later phases APPEND to (Implementation Notes, Test Plan, PR
title/body), not a machine-only data interchange format.

## Interfaces / contracts

- The skill's entry point takes a card name OR a set code (`SPEC-TALISHAR.md §8`'s literal
  invocation shape: `/talishar-implement-card <card name or set-code>`). A set-code invocation
  implies "assemble dossiers for every not-yet-implemented card in that set" — out of scope detail
  for TAL-020 to fully design (a single-card dossier is the AC's test case;
  TAL-021+ can extend to batch mode if needed), but the skill's phase-1 output format must not
  preclude it.
- **Never answer from model memory (§10 I4, hard invariant)**: every fact in the dossier's Card
  Vault/rulings/stats sections must be the literal output of a live tool call
  (`fab-cli fabtcg card`, `fab-cli fabrary cards local`), never paraphrased from training data. The
  skill file states this as a standing invariant, matching `talishar-fork-sync`'s pattern.
- **§8.1a dataset-gap handling** is not an error path — it's a first-class, expected outcome for
  newly-announced cards. The dossier's "Status" and "Dataset gap" fields make this explicit rather
  than the skill silently failing or fabricating stats.
- **Similar-implementation lookup is knowledge-driven, not code-search**: it queries the talishar
  brain (TAL-013's seeded notes) rather than grepping `third_party/talishar/Classes/CardObjects/`
  blind — the brain's recipe-pattern notes are the curated index; falling back to a raw grep is
  acceptable only if brain recall genuinely finds nothing relevant (record that in the dossier too,
  don't silently skip the field).
- **Persistence enables resume**: if a session assembling a dossier is interrupted, a later
  invocation of the skill on the same card must detect the existing dossier file and resume/update
  it rather than starting over — this is what "so later phases/resumes consume it" (§8.1) requires.

## Key sequences

1. User (or a later pipeline phase) invokes `/talishar-implement-card "<Card Name>"`.
2. Skill checks for an existing dossier at `.claude/talishar/dossiers/<card-slug>.md`; if present
   and its Status is still `dossier`, resume/refresh it rather than re-running everything from
   scratch (cheap re-checks: is Card Vault text still current, has the-fab-cube dataset caught up
   on a previously-recorded gap).
3. Fetch Card Vault true text + rulings (`fab-cli fabtcg card`).
4. Look up the-fab-cube stats (`fab-cli fabrary cards local --exact`); if absent, record the §8.1a
   gap and derive stats from Card Vault/spoilers instead — flag the generator-regeneration TODO.
5. Optional Fabrary context lookup (`fab-cli fabrary cards search`) — skip gracefully (note "no
   data") if the card has no meaningful usage signal yet (common for new cards).
6. Recall talishar brain notes for matching implementation patterns; cite the closest
   `tal-recipe-*` note(s) and, if helpful, the real vendored card class(es) they reference.
7. Record the official image reference.
8. Write/update the dossier file, set Status to `dossier` (complete, ready for TAL-021 to consume).

## Decisions

- **TAL-020 builds the dossier phase ONLY.** Phases 2–4 (implementation, images, validation +
  hand-off) are TAL-021/022/023, separate tasks in this same epic — the skill file this task
  creates should have clear phase boundaries (even if phases 2–4 are stubbed as "not yet
  implemented, see TAL-021/022/023") so later tasks extend the same file rather than each task
  creating a competing entry point.
- **Dossiers are ephemeral, gitignored working state, not committed knowledge.** They describe an
  in-progress upstream contribution (which card, what branch, what's blocking it) — this is
  fundamentally different from the talishar brain's `tal-*` notes (durable, reusable engine
  knowledge). Committing dossiers to fab-cli would also risk leaking pre-release card text/spoilers
  into git history before a card is officially public.
- **The skill is genuinely testable at the dossier-assembly-logic level even though it orchestrates
  live network calls.** TDD approach: any pure logic (dossier markdown formatting, gap-detection
  logic, resume/merge logic for an existing dossier file) gets real unit tests with mocked
  `fab-cli` outputs; the live-tool-invocation orchestration itself is exercised by the skill
  markdown's own "Steps" being followed by an agent, not by an automated test (matching how
  `talishar-fork-sync`'s actual fork operations aren't unit-tested, only its idempotent-script
  logic is — see `test/talishar-fork-sync.test.ts` for the precedent: script-level tests, not
  live-network tests, and §10 I6 still applies — the gate never depends on live network/vendored
  clones).
- **A small TypeScript helper module is warranted if the dossier-formatting/gap-detection logic
  has enough real behavior to unit-test** (e.g. `src/talisharDossier.ts` with a pure
  `formatDossier(input): string` and `detectDatasetGap(cardSlug): boolean` type functions) — this
  gives TAL-020 a genuine TDD surface instead of the doc-task-adapted-TDD pattern used for
  TAL-010/011/013. Prefer this over pure-markdown-skill-with-no-code if the logic is non-trivial;
  the dev agent should judge based on how much real branching logic the gap-detection/resume
  behavior actually needs.

## TAL-021 — Implementation phase

Grounded in: SPEC-TALISHAR.md §8.2, §8.3, §10 I2, I4.

### Components

- `.claude/skills/talishar-implement-card/SKILL.md` — extend the existing skill file's Phase 2
  (currently stubbed) with fully-specified Steps, following the same "Standing invariants" +
  numbered "Steps" shape as Phase 1.
- All actual code changes for a card implementation happen in `third_party/talishar` (the vendored
  engine clone) — a gitignored, separate git repository. **Nothing in this phase touches fab-cli's
  own `src/`/`test/` tree for card behavior** — `src/talisharDossier.ts` (TAL-020) stays fab-cli's
  only card-pipeline-adjacent source file; the actual `Card` subclass PHP lives entirely in the
  vendored clone.

### Data models

No new fab-cli data model. The dossier (TAL-020's `formatDossier` shape) gains an **Implementation
Notes** section, appended in place once implementation starts — same file, `## Status` flips from
`dossier` to `implementing`.

### Interfaces / contracts

- **Branch naming and base** (§8.2): `feat/{card_id}` on `third_party/talishar`, based on a
  freshly-synced `upstream/main` — run `/talishar-fork-sync` (or its script,
  `scripts/talishar-fork-sync.sh`) FIRST, every time, before branching. Never branch off a stale
  local `main`.
- **Recipe fidelity** (§8.3, grounded in TAL-013's `tal-recipe-*` brain notes and TAL-020's
  dossier): `zzCardCodeGenerator.php` output covers stats/types/pitch/cost automatically — only add
  a `class {card_id} extends Card` with the SPECIFIC hooks the card's true text requires
  (`PlayAbility`/`SpecificLogic`/`ProcessTrigger`/`CombatEffectActive`/`EffectPowerModifier`/etc.),
  never a hook the card doesn't use. Touch `Constants.php`/`MenuFiles/StartHelper.php`/ability
  files ONLY if the card genuinely needs new `ClassState` or a new engine-level hook — most simple
  cards need none of that.
- **§10 I4 (hard invariant, never violate)**: every behavioral decision in the implementation must
  trace back to the dossier's Card Vault true text, never to remembered/assumed card text. If the
  dossier is missing or stale for the target card, STOP and run/refresh the dossier phase first
  (TAL-020's skill) rather than implementing from memory.
- **§10 I2 (hard invariant)**: branch and commit only to `origin` (the user's fork) inside
  `third_party/talishar` — this phase never touches `upstream`, and if the fork's `main` has
  diverged non-fast-forward from `upstream/main`, that's a `/talishar-fork-sync` finding to
  surface, not something this phase force-pushes past.
- **"php -l clean on touched files"** (the task's literal AC) — run `php -l` on every PHP file the
  implementation touches before considering the phase done. Requires a local `php` binary (install
  via `brew install php` if missing — a normal one-time dev-environment setup step, not a
  project-gating dependency).
- **"diff contains no unrelated changes"** (the task's literal AC) — `git -C third_party/talishar
  diff upstream/main --stat` on the finished branch should show ONLY the files a real card
  implementation of this shape touches (compare against the #1370/#1369 shape: typically the
  `{SET}Cards.php` file, and only `Constants.php`/`StartHelper.php`/an ability file if a genuinely
  new `ClassState` was needed).

### Key sequences

1. **Choose the target card.** TAL-021's own AC test case: "a modal-or-simpler card" — modal
   complexity is the UPPER bound, a plainer single-hook card is an equally valid (simpler) choice.
   Selection criteria: (a) NOT already implemented with real custom hooks in
   `third_party/talishar/Classes/CardObjects/{SET}Cards.php` (an empty-constructor-only class, or
   no class at all, both count as "not yet implemented" — `zzCardCodeGenerator.php`-only coverage
   is not an implementation); (b) has a real, findable rules text via Card Vault (`fab-cli fabtcg
   card`); (c) mechanically simple enough for a first pipeline exercise — a single on-play/on-hit
   effect, or at most one modal choice, no exotic archetype (windup, multi-card combos). Use
   `fab-cli fabrary cards local`/`fab-cli fabtcg card` plus a grep of
   `third_party/talishar/Classes/CardObjects/` to find a real candidate — do not invent a
   hypothetical card.
2. Run `/talishar-fork-sync` to freshly sync `third_party/talishar`'s fork against upstream.
3. Run the dossier phase (TAL-020's skill, Phase 1) against the chosen card for real — this
   produces the true text + similar-implementation citation the implementation must be grounded in.
4. Branch `feat/{card_id}` off the freshly-synced `origin/main` inside `third_party/talishar`.
5. Implement per §8.3 — minimal hook set, citing the dossier at every behavioral decision point.
6. `php -l` every touched PHP file; fix any syntax errors.
7. Update the dossier: `## Status` → `implementing`, append an `## Implementation Notes` section
   recording which hooks were used and why, citing the dossier's true text for each.
8. Do NOT push the branch yet (§8.6/hand-off is TAL-023's job) — leave it as a local, validated
   branch on the vendored clone.

### Decisions

- **This phase's "done" state is a local, uncommitted-to-any-remote branch inside
  `third_party/talishar`.** Pushing to the fork and preparing PR text is explicitly TAL-023's job
  (§8.6) — TAL-021 stops at "implemented and `php -l` clean," matching §8.7's "never push a branch
  whose validation did not run" (validation is TAL-023, via the docker stack).
- **Card selection is part of this task's own research, not a pre-assigned card name** — the AC
  only constrains complexity ("modal-or-simpler"), not identity. The dev agent doing TAL-021 picks
  a real, currently-unimplemented, simple card and documents why it fits the AC's shape.
- **fab-cli's own TDD/gate is unaffected by this phase.** All the real work (PHP, a separate git
  repo) happens inside the gitignored `third_party/talishar` clone; fab-cli's `npm run gate` stays
  green trivially UNLESS this task also extends the skill file (a fab-cli-tracked markdown file),
  which does need its own structural test update mirroring TAL-020's pattern (Phase 2's Steps now
  present, not stubbed).

## TAL-023 — Validation + hand-off, end-to-end run

Grounded in: SPEC-TALISHAR.md §8.5, §8.6, §8.7, §10 I1.

### Components

- `.claude/skills/talishar-implement-card/SKILL.md` — extend Phase 4 (currently stubbed) with
  fully-specified Steps, same shape as Phases 1-2.
- No new fab-cli source files expected — this phase is almost entirely operational (bring up a
  docker stack, exercise a card, push a branch), not logic to unit-test. The one fab-cli-tracked
  artifact is the skill-file extension itself, which gets the same structural-test TDD treatment
  as Phases 1/2.

### Interfaces / contracts

- **Bring-up**: `bash start.sh` inside `third_party/talishar` (per the already-merged
  `docs/TALISHAR-ARCHITECTURE.md`'s "Local Dev Stack" section and `tal-dev-*` brain notes) —
  Apache/PHP on port 8080, MySQL, Redis. Sibling mount requirement (`../Talishar-FE`,
  `../CardImages`) is already satisfied by this repo's vendoring layout
  (`third_party/{talishar,talishar-fe,talishar-cardimages}` as direct siblings).
- **Exercise the card via API, not a browser automation tool** — SPEC §8.5 says "FE or API
  endpoints"; for an agent, the API path (`third_party/talishar/APIs/*.php` — already mapped in
  TAL-013's `tal-arch-api-surface` brain note) is far more reliable to script than driving the
  React FE. Play a game that gets the target card (Wrecking Ball, from TAL-021) into play and
  attacking, and confirm via the game state response that: the draw happened, the discard
  happened, and (if the discarded card's power was ≥6) Intimidate applied — or, if it wasn't ≥6,
  that Intimidate correctly did NOT apply. Exercising BOTH branches of the conditional (if
  feasible in one or two short games) is stronger evidence than one happy-path run.
- **Recorded as the dossier's Test Plan** (per TAL-020's dossier shape) — update
  `.claude/talishar/dossiers/wrecking-ball.md`'s `## Status` to `ready-for-pr` and append a `##
  Test Plan` section describing exactly what was exercised and observed, in the shape upstream PR
  bodies use (this becomes the literal PR body's Test Plan section in the next step).
- **§8.7 (hard invariant)**: if the stack fails to start, or observed behavior doesn't match the
  dossier's true text, STOP at that phase and update the dossier to describe the blocker — never
  push a branch whose validation did not run. A failed validation is a legitimate, complete
  outcome for this task (report it, don't force a push).
- **Hand-off (§8.6)**: once validation passes, push `feat/wrecking_ball_red` to `origin`
  (`git@github.com:Zugruul/Talishar.git`, the user's fork) — a normal `git push`, nothing more.
  Then emit, as TEXT ONLY (never actually create anything on GitHub), a prepared PR title
  (`feat: {Card Name} ({SET}{number})` — e.g. `feat: Wrecking Ball (RVD013)`) and body (Summary +
  Test plan, upstream convention, dossier-cited).
- **§10 I1 (hard invariant, never violate)**: this phase pushes to `origin` (the fork) and STOPS.
  It NEVER calls `gh pr create`, `gh pr merge`, `gh pr ready`, or any other PR-mutating action
  against `Talishar/Talishar`. The prepared title/body is text for the human to paste in
  themselves.

### Key sequences

1. Confirm the dossier's Status is `implementing` (TAL-021's end state) and the target card's PHP
   change exists on its local branch (from TAL-021).
2. `cd third_party/talishar && bash start.sh` — bring up the docker stack. If it fails, STOP
   (§8.7) and report the exact failure (build error, port conflict, etc.) rather than working
   around it in a way that could mask a real problem.
3. Once up, use the API endpoints to start a game, get to a state where the target card can
   attack, and observe the response for the implemented behavior (draw, discard, conditional
   Intimidate).
4. Record the observed behavior in the dossier's new `## Test Plan` section.
5. `git push origin feat/wrecking_ball_red` (from `third_party/talishar`).
6. Emit the prepared PR title + body as plain text in the task's final report (and, if useful, as
   a file the human can copy from) — never touch GitHub's `Talishar/Talishar` repo itself.
7. Bring the docker stack back down (`docker compose down` or equivalent) — don't leave it running
   after the task ends.

### Decisions

- **API-based validation, not FE browser automation.** SPEC §8.5 permits either; the API path is
  the practical choice for an autonomous agent (scriptable, deterministic, no browser-automation
  flakiness) and is already well-mapped by TAL-013's brain notes.
- **The dossier's Test Plan section is the reusable artifact** — both the human-facing "what did
  you actually verify" record AND, verbatim or near-verbatim, the eventual PR body's Test Plan.
  Write it once, in upstream-PR-body-ready prose.
- **Bringing the stack down after validation is part of "done"** — this task shouldn't leave a
  docker stack running as a side effect for the next session to discover.

## Out of scope for this epic-task

- Image pipeline step (TAL-022): CardImages script runs, FE `generate-cards` refresh.
- Latency/DX audit (E3) — unrelated to the card pipeline's dossier phase.
