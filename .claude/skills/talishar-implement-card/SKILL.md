---
name: talishar-implement-card
description: Research and implement a Flesh & Blood card in the vendored Talishar game engine, phase by phase — dossier (research), implementation, images, and validation + hand-off. Use when the user says "implement card X for Talishar", "/talishar-implement-card <card name or set-code>", or wants to start/resume a Talishar card-implementation contribution.
---

# talishar-implement-card

Orchestrates the four-phase card-implementation pipeline described in
`docs/design/talishar-E2.md` and `SPEC-TALISHAR.md` §5, §8.1–§8.7:

1. **Dossier** (this task, TAL-020) — research phase, fully specified below.
2. **Implementation** (TAL-021) — not yet implemented.
3. **Images** (TAL-022) — not yet implemented.
4. **Validation + hand-off** (TAL-023) — not yet implemented.

Invocation: `/talishar-implement-card "<card name>"` or `/talishar-implement-card <set-code>`
(a set-code invocation implies "assemble dossiers for every not-yet-implemented card in that
set" — batch mode is left to a future task; treat a single card name as the primary case).

## Standing invariants (never violate these — SPEC-TALISHAR.md §10 I1/I2/I4)

- **I1 — never open, mark ready, approve, or merge pull requests on Talishar org repositories.**
  Tooling pushes branches only to the user's forks and prepares PR title/body as text — a human
  creates every upstream PR. Nothing in this skill (including future phases) ever calls `gh pr
  create`, `gh pr merge`, or `gh pr ready` against a `Talishar/*` repo.
- **I2 — `upstream` is fetch-only in every vendored clone.** `origin` is the user's fork
  (`git@github.com:Zugruul/<repo>.git`); nothing is ever pushed to `upstream`, and a diverged fork
  `main` is reported, never force-pushed.
- **I4 — card behavior implementations are derived from live Card Vault true text plus the-fab-cube
  stats and the CR at implementation time — never from remembered card text.** This is the whole
  reason the dossier phase exists: every fact in it must be the literal output of a live tool
  call, never paraphrased from training data. If you find yourself about to write a card's rules
  text from memory, stop and run the tool call instead.

## Phase 1 — Dossier (research)

Goal: assemble a single persisted markdown file per card so later phases (or a resumed session)
can consume it without redoing research. See `docs/design/talishar-E2.md`'s "Data models" section
for the full field-by-field rationale; the shape below is authoritative.

### Steps

1. **Compute the dossier path.** Slugify the card name (`slugifyCardName` in
   `src/talisharDossier.ts` — lowercase, strip apostrophes, collapse everything else to single
   hyphens) and look for `.claude/talishar/dossiers/<card-slug>.md`.
2. **Check for an existing dossier.** If the file exists, read it and extract its `Status` field
   (`parseExistingStatus`). Only resume/refresh in place when `shouldResumeDossier(status)` is
   true — i.e. the dossier's Status is still exactly `dossier` (not `implementing`, `images`,
   `validating`, `ready-for-pr`, or a `blocked: ...` reason — those mean a later phase already
   claimed the card, or a human parked it on purpose; do not silently overwrite either). If it's
   further along, tell the user rather than clobbering it.
3. **Fetch Card Vault true text + rulings**: `fab-cli fabtcg card "<card name>"`. Copy the TRUE
   TEXT block and the cardvault.fabtcg.com URL verbatim — never paraphrase. If the command's
   plain-text output doesn't expose a rulings list directly for this card, note "no official
   rulings" (that is a real, common outcome — most cards have none — not a lookup failure; a
   genuine lookup failure, e.g. no Card Vault match at all, must be recorded distinctly, per the
   same three-state pattern `fabrary cards show`'s rulings section already uses).
4. **Look up the-fab-cube stats**: `fab-cli fabrary cards local --exact "<card name>"`. If it
   returns at least one match, record the stats block. If it returns zero matches, that's the
   §8.1a dataset gap — call `detectDatasetGap([])` → `true` and follow step 4a instead of
   inventing stats.
   - **4a. Dataset gap (§8.1a, not an error path).** Record the gap explicitly: the card isn't in
     `third_party/flesh-and-blood-cards` yet (newly announced), so stats must be derived from the
     Card Vault text / official spoilers gathered in step 3 instead, and
     `zzCardCodeGenerator.php` output will need regeneration once the dataset submodule catches
     up (`git submodule update --remote third_party/flesh-and-blood-cards`). This is expected for
     brand-new cards — do not treat it as a blocker, just flag it honestly in the dossier's
     Dataset gap section.
5. **Optional Fabrary context**: `fab-cli fabrary cards search "<card name>"` — record anything
   implementation-relevant (is this a common reprint, does it carry keywords/interactions worth
   flagging). If there's no meaningful signal (typical for a brand-new card), record "no notable
   usage data" rather than leaving the section blank.
6. **Recall the talishar brain for a matching implementation pattern.** Query with real terms
   from the card's mechanics (its keywords, its trigger shape — "modal", "combat-modifier",
   "on-hit trigger", etc.), not the card's own name:
   ```bash
   bash "/Users/vieiral/.claude/plugins/cache/development-skills/spec-workflow/0.25.0/scripts/brain.sh" \
     recall talishar --keywords "<mechanic terms>"
   ```
   The exact path is pinned to the installed plugin version and may drift — if it 404s, locate the
   current one with `find ~/.claude/plugins -name brain.sh -path '*spec-workflow*'`.
   Cite the closest `tal-recipe-*` (and, if helpful, `tal-arch-*`) note(s) by name plus a one-line
   reason the pattern fits — even a partial fit is worth citing explicitly (e.g. "the note's full
   skeleton is a modal card, but its `ProcessTrigger` branch has the exact on-hit draw-a-card
   logic this card needs"). **If brain recall genuinely finds nothing relevant, do not silently
   skip this section** — try one fallback grep of `third_party/talishar/Classes/CardObjects/` for
   a mechanically similar card, and record either that fallback's finding or the explicit fact
   that neither the brain nor a grep found a match.
7. **Record the official image reference** — a link/identifier only (the cardvault URL from step
   3 usually suffices); do not download or process the image here, that's TAL-022.
8. **Write the dossier.** Use `formatDossier` (`src/talisharDossier.ts`) with the data gathered
   above, set `status` to `dossier`, and write it to
   `.claude/talishar/dossiers/<card-slug>.md` (create the directory if needed — it's gitignored,
   never commit anything under it).

### Dossier file shape

```markdown
# Dossier: <Card Name> (<SET><number>)

## Status
dossier

## Card Vault true text
<verbatim TRUE text from `fab-cli fabtcg card`, with the cardvault URL>

## Rulings / errata
<any rulings_errata entries, or "no official rulings">

## the-fab-cube stats
<stats block, OR "GAP: not yet in dataset — see Dataset gap section below.">

## Fabrary context
<brief usage/meta note, or "no notable usage data">

## Similar existing implementation(s)
<1+ vendored card class(es)/brain notes found via brain recall, cited by name, with a one-line
note on why it's the closest pattern match>

## Official image reference
<link/identifier>

## Dataset gap
<only present when the card isn't yet in the-fab-cube dataset — see step 4a>
```

## Phase 2 — Implementation (not yet implemented)

Creating the upstream branch, writing the actual `Card` subclass, touching
`Constants.php`/ClassState files. See **TAL-021**. Do not attempt this phase until it has its own
task/skill section — a dossier alone is not enough context to safely write game logic.

## Phase 3 — Images (not yet implemented)

CardImages script runs, FE `generate-cards` refresh. See **TAL-022**.

## Phase 4 — Validation + hand-off (not yet implemented)

Docker stack, real game exercise, PR text preparation, branch push to the fork (never the PR
itself — see invariant I1). See **TAL-023**.

## What this skill does NOT do (yet)

- It does not write any `Card` subclass or touch the vendored engine's PHP — that's TAL-021.
- It does not download, resize, or crop card images — that's TAL-022.
- It does not run the docker dev stack or exercise a real game — that's TAL-023.
- It never opens, approves, or merges a PR on a `Talishar/*` org repo (I1) — no phase of this
  pipeline ever will; a human creates every upstream PR.
