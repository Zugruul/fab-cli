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

## Out of scope for this epic-task

- Implementation phase (TAL-021): creating the upstream branch, writing the actual `Card` subclass,
  touching `Constants.php`/ClassState files.
- Image pipeline step (TAL-022): CardImages script runs, FE `generate-cards` refresh.
- Validation + hand-off (TAL-023): docker stack, real game exercise, PR text preparation, branch
  push to the fork.
- Latency/DX audit (E3) — unrelated to the card pipeline's dossier phase.
