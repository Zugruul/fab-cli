# Design — fab/E5: Fabrary analysis

Grounded in: SPEC §9.5, §5.

## Components

- `src/commands/fabrary.ts` gains `fabrary prep --hero <X> --vs <Y>` — a new subcommand under the `fabrary` namespace (sibling to `top`/`meta`/`deck`), NOT a new top-level command.
- New `buildPrepSheet(heroX, heroY, opts): Promise<PrepSheet>` function — dev agent's call whether this lives in a new `src/prep.ts` module (matching the pattern of `src/meta.ts`/`src/stats.ts` as separate concern modules) or inline in `commands/fabrary.ts` if small enough; given it composes two existing data sources (meta + top-decks + matchup guides), a separate module keeping `commands/fabrary.ts` as thin wiring matches this codebase's established convention (see `src/meta.ts`, `src/stats.ts`) — prefer the separate-module approach.
- Reuses, unchanged: `fetchMetaResults()` (`src/meta.ts` — the ONLY source of real hero-vs-hero win rate/game-count data, see Data model below for why), `searchDecks()` (`src/algolia.ts`, same fetch pattern `fabrary top --hero X` already uses to find X's decks), `getResults()`/`getDeck()` (`src/graphql.ts`, per-deck matchup guides), and the EXISTING partial-name matchup-lookup logic already used by `deck --matchup <name>` (read `src/commands/fabrary.ts`'s existing `--matchup` handling — reuse its exact matching semantics, don't reinvent).

## Data model — critical constraint (read before designing anything else)

**`GameResult` (per-deck individual game results, from `getResults()`) has NO opponent-hero field** — confirmed in `src/types.ts`: `{ result, source, notes, deckId, gameId, turns, firstPlayer, cardResults }`. There is no way to compute "X-vs-Y win rate" by filtering individual games by opponent hero — that data simply isn't tracked at the per-game level anywhere in the fabrary API surface this codebase talks to.

The ONLY real source of hero-vs-hero win-rate/game-count data is `content.fabrary.net`'s meta-results endpoint, already wrapped by `fetchMetaResults()` (`src/meta.ts`), which returns `HeroMetaRow[]` with `matchups: HeroMatchup[]`, each `{ hero, opponent, wins, losses, games, winRate }` — this is EXACTLY the "X-vs-Y matchup: win rate + game count" SPEC §9.5 asks for, already built and already used by the existing `fab-cli fabrary meta --hero X` command.

So `prep --hero X --vs Y`'s "aggregate... the X-vs-Y matchup: win rate + game count" clause is satisfied by looking up hero X's `HeroMetaRow` (via `fetchMetaResults()`, same as `meta --hero` does today) and finding the `HeroMatchup` where `opponent === Y`. This is NOT computed fresh from individual top-X-decks' game results (impossible, per above) — it's the SAME pre-aggregated meta stat `fab-cli fabrary meta --hero X` already surfaces for that specific opponent.

```ts
export interface PrepSheet {
  heroX: string;
  heroY: string;
  matchupStat: HeroMatchup | null;   // null → "no meta data for this matchup" (§AC's "explain why")
  deckGuides: PrepDeckGuide[];        // one entry per top-X deck that HAS a Y matchup guide
  decksWithoutGuide: number;          // count of top-X decks checked that had NO Y-specific guide (transparency, not an error)
}

export interface PrepDeckGuide {
  deckId: string;
  deckName: string;
  author: string;
  matchup: MatchupSummary;            // existing type — name/preferredTurnOrder/notes
  cardDiff: { added: DeckCardDiffEntry[]; removed: DeckCardDiffEntry[] }; // sideboard diff, same shape `deck --matchup` already renders
}
```

## Interfaces / contracts

- **Top-X-decks selection**: reuse the SAME deck-search + results-filter logic `fabrary top --hero X` already uses (`searchDecks` with hero facet + `--has-results`-equivalent filtering) — this task does not invent a new "top decks" ranking, it uses the existing one. A reasonable default limit (e.g. the same default `top` uses, or a smaller cap like 10 since this command does MORE per-deck work — fetching full deck detail for each candidate, not just results) — dev agent's call, document the choice.
- **Per-deck matchup lookup**: for each top-X deck, fetch its full detail (`getDeck`, same call `fabrary deck <id>` uses) and search its `matchups: MatchupSummary[]` for one whose `name` partial-matches `Y` — REUSE the exact partial-match logic already in `deck --matchup <name>`'s existing handler (read it, don't reimplement the matching semantics differently). A deck with no matching guide is counted in `decksWithoutGuide`, not treated as an error — most decks won't have a guide for every possible opponent.
- **"Output covers ≥ the data `deck --matchup` exposes today" (AC)**: `deck --matchup <name>` today prints, per the existing `printMatchupCards`-based rendering: matchup name, preferred turn order, notes, and the sideboard card diff (`-Nx Card` removed / `+Nx Card` added, with pitch dots). `prep`'s per-deck guide section must render AT LEAST this same information for each `PrepDeckGuide` entry (labeled with which deck it came from — deck name + author, since `prep` aggregates ACROSS decks, unlike `deck --matchup` which is scoped to one deck) — this is a floor, not a ceiling; don't strip detail `deck --matchup` already shows.
- **"Heroes without data explain why" (AC)**: two independent "no data" cases, each with ITS OWN explanation (don't conflate):
  1. `matchupStat === null` (no meta data for X-vs-Y) → print something like "No recorded matchup data for `<X>` vs `<Y>` in the current meta period" (mirrors how `meta --hero <id>` already handles an unknown/no-data hero — check that command's existing empty-state message and match its tone).
  2. `deckGuides.length === 0` (meta stat may exist, but zero top-X decks have a Y-specific written guide) → print something like "No deck-specific matchup guides found for `<Y>` among the top `<N>` `<X>` decks checked" — distinct message from case 1, since one is "no aggregate stat" and the other is "no written guide," and a user could hit either independently (case 1 without case 2, or vice versa).
- **`--format`/other existing filters**: `top --hero X` already supports `--format`; `prep` should accept the same `--format` option (hero identifiers can be ambiguous across formats — SA young vs CC adult slugs per this repo's own documented convention) and thread it into both the meta lookup (`fetchMetaResults` takes a format) and the deck search.

## Decisions

- **Meta endpoint is the win-rate/games source, not raw game aggregation** — the only architecturally honest choice given `GameResult` has no opponent-hero field; inventing a fake "aggregate from top decks' games" computation would either silently be wrong (if games get miscounted against the wrong opponent) or require data the API doesn't expose. This is the single most important design decision in this doc — a dev agent that doesn't read this section carefully might try to compute win-rate from `GameResult[]` directly and find it's impossible partway through implementation.
- **Reuse `deck --matchup`'s exact partial-match semantics** — consistency: a user who already knows how `--matchup <name>` resolves a fuzzy name shouldn't have to learn different matching rules for `prep --vs <name>`.
- **Two distinct "no data" messages, not one generic fallback** — per AC's explicit "explain why," a single "no data" message covering two structurally different absences (no aggregate stat vs. no written guides) would under-explain the actual reason.
- **`decksWithoutGuide` is informational, not an error/warning** — most top decks for a hero won't have a specific matchup guide for every possible opponent; this is normal, expected fabrary data, not a defect to flag loudly.

## Out of scope for this epic (E5)

- Any change to `fabrary top`, `fabrary meta`, or `fabrary deck --matchup`'s existing behavior — this task only composes their existing outputs, doesn't modify them.
- Computing win-rate from raw per-game data even as a fallback when meta data is absent — per the Data model section, this isn't possible with the data available; `matchupStat === null` is a genuine, honest "no data" state, not a gap to paper over with a worse computation.
