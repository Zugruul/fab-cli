# Design — fab/E3: Player & judge identities

Grounded in: SPEC §5, §8.0–§8.6, §10 I1–I9; `development-skills/docs/design/cross-identity-correlation.md` §3–§6.

## Components

- `.claude/identities/<role>/brain/notes/` — role-owned knowledge notes; generated card and keyword notes live physically in `card-vault`, while judge/player notes remain hand-owned.
- `scripts/build-card-vault.py` — deterministically generates card notes and name-level `card:` entity declarations from the vendored card corpus.
- `scripts/keyword-sync.py` — validates the physical keyword corpus, mirrors it by symlink, and maintains `keyword:` entity declarations.
- `scripts/backfill-entities.py` — one-shot proposal tool for adding entity declarations to hand-owned judge/player notes without silently editing them.
- `.claude/identities/entity-index.json` — committed, generated repo-level lookup from entity keys to role/slug references; never a source of game facts.

## Data models

| Model | Shape | Invariants |
| --- | --- | --- |
| Entity declaration | Frontmatter `entities: [<kind>:<name-level-kebab>, ...]` | Optional; variant-independent; owned by the note's brain; kinds are open-ended. |
| Entity index | Generated JSON mapping each entity to a canonical anchor (or `null`) and role/slug note pairs | Contains metadata only; deterministic and committed; symlinked notes are attributed to their physical home once. |
| Backfill proposal | Reviewable note diff inferred from card-name tags and conservative prose matches | Never auto-committed; hand-owned note bytes change only through this explicit tool/review. |

## Interfaces / contracts

- Generated card notes declare `entities: [card:<name-level-kebab>]`; namesake disambiguation matches the card-note disambiguator without the `card-` prefix.
- Physical `kw-*` notes declare `entities: [keyword:<slug>]`; mirrors inherit the same bytes through symlinks.
- Builders regenerate the entity index after successful writes/syncs; their check modes fail when expected entity declarations or the generated index are stale.
- `backfill-entities.py` proposes declarations for judge/player notes from card-name evidence with a minimum six-character prose-match guard.
- All builders remain deterministic and network-free under the merge gate.

## Key sequences

1. A card/keyword builder derives stable entity keys from its authoritative local corpus, renders declarations into generated notes, then regenerates the repository entity index.
2. Check mode renders expected output in memory and fails on declaration/index drift without mutating the tree.
3. The backfill tool scans hand-owned notes, proposes conservative declarations as a reviewable diff, and leaves acceptance/commit to the judge/player editorial process.
4. Regeneration runs twice with identical output and preserves hand-owned note bytes exactly.

## Decisions

- Use declared real-world entities plus a generated index — stable correlations must not depend on note slug schemes or pollute role-private `links.json`.
- Keep entity keys name-level and variant-independent — pitch variants and generator migrations must correlate to the same card.
- Keep cross-role recall unchanged — the index makes relationships discoverable but does not inject foreign note content into a role's recall.
- Commit the index — fresh clones and visualization consumers receive a reviewable, reproducible artifact.
- Require explicit review for hand-note backfill — judge/player brains are editorial knowledge, not generator-owned output.

## Out of scope for this epic

- Implementing plugin-side `brain.py`, ask-brain/ask-identity, neural-view, or retro-protocol features owned by `development-skills`.
- Changing FAB rules, card legality, or lore-answer behavior.
- Adding cross-role content to per-role recall or weakening judge-to-player knowledge-flow rules.
