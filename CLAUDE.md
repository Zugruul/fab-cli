# fabrary-cli

A CLI for searching Flesh & Blood cards and decks via fabrary.net.

## Project Structure

```
bin/fab.js          — Global entry point (uses tsx to run TypeScript directly, no build step)
src/cli.ts          — All commands and CLI logic (Commander.js)
src/algolia.ts      — Deck search via Algolia (public_decks index) + direct deck lookup by ID
src/graphql.ts      — Card search and deck results/matchups via AppSync GraphQL
src/display.ts      — Table and detail output (cli-table3 + chalk)
src/stats.ts        — Deck composition and game result stats computation
src/config.ts       — Auth token persistence (~/.config/fabrary-search/config.json)
src/cognito.ts      — Cognito login + token refresh
src/types.ts        — Shared TypeScript interfaces
```

## Dev & Install

```bash
npm i -g . --force   # install/reinstall globally (use --force to overwrite existing bin)
fabrary --help
```

No build step — `bin/fab.js` registers tsx and requires `src/cli.ts` directly.

## Auth

Credentials are stored at `~/.config/fabrary-search/config.json` (authToken, refreshToken, tokenExpiry).
Access tokens auto-refresh via the stored refresh token when within 5 minutes of expiry.

```bash
fabrary login                  # interactive email + password login
fabrary auth <raw-token>       # save a raw token manually (advanced)
```

## Commands

### Deck Search

```bash
fabrary heroes [--filter <text>]
fabrary formats
fabrary search [--hero <id>] [--format <fmt>] [--days <n>] [--has-matchups] [--has-results] [-q <text>] [-n <limit>] [-p <page>]
fabrary top   [--hero <id>] [--format <fmt>] [--days <n>] [--min-games <n>] [--source <src>] [-n <limit>] [--show <n>]
fabrary deck <deckId>          # full deck: header + decklist + matchup guides + stats
fabrary deck <deckId> --decklist-only
fabrary deck <deckId> --matchups-only
fabrary deck <deckId> --stats-only
fabrary deck <deckId> --matchup <name>   # single matchup guide (partial name match)
fabrary deck <deckId> --source <src>     # filter results by source (FaBrary, Talishar)
```

Format aliases: `cc` → Classic Constructed, `sa` → Silver Age, `blitz` → Blitz, `ll` → Living Legend, `upf` → Ultimate Pit Fight.

Hero identifiers use slug format, e.g. `vynnset-iron-maiden`, `prism-awakener-of-sol`.

### Card Search

```bash
fabrary cards search "<text>" [flags]
fabrary cards show "<text>"    # full detail for first match
```

**Inline text filters** (appended to search string):
- `r:Rarity` — e.g. `r:Majestic`, `r:Legendary`
- `t:Type` — e.g. `t:Hero`, `t:Action`, `t:Equipment`
- `k:Keyword` — e.g. `k:Dominate`, `k:"Go again"`

**Flag filters** (client-side post-filter on full card data):
| Flag | Description | Values |
|------|-------------|--------|
| `--foiling` | Foiling type | Cold, Gold, Rainbow |
| `--treatment` | Art treatment | Alternate Art, Full Art, Extended Art, Alternate Border, Alternate Text |
| `--artist` | Artist name (partial) | any |
| `--set` | Set name (partial) | e.g. "Dusk till Dawn", Promos |
| `--edition` | Edition | Alpha, Unlimited, etc. |
| `--spec` | Specialization hero | e.g. Vynnset |
| `--subtype` | Subtype | Attack, Young, 1H, 2H, Aura, etc. |
| `--class` | Hero class | Runeblade, Ninja, Brute, Guardian, etc. |
| `--talent` | Talent | Shadow, Light, Ice, Earth, Lightning, Draconic, etc. |
| `--fusion` | Fusion element | Earth, Ice, Lightning |
| `--legal` | Legal in format | CC, Blitz, SA, ll, upf (uses same aliases as deck search) |
| `--pitch` | Pitch value | 1 (red), 2 (yellow), 3 (blue) |
| `--cost` | Cost value | number |
| `--power` | Power/attack value | number |
| `--defense` | Defense value | number |
| `-d, --detail` | Show full card detail instead of table | — |

## Deck Output Format

The `deck` command outputs three sections in order:

**1. Header + Decklist** (`--decklist-only`)
- Name, hero, format, author, updated date, link
- Win/loss record if results exist
- List of matchup guide names
- Tags
- Card list split into: `hero + equipment (N)`, `main deck (N)`, `inventory (N)`

**2. Matchup Guides** (`--matchups-only`)
- Per-matchup diff vs base deck: `-Nx Card ●` removed, `+Nx Card ●` added from inventory
- Pitch dots: ● red, ●● yellow, ●●● blue, no dot for equipment/no-pitch
- Preferred turn order + cards-in-deck count
- Notes if present (e.g. mirror match strategy text)

**3. Stats** (`--stats-only`)
- Results: W/L record + win rate + by source breakdown
- Summary: going first/second win rates, avg turns (overall / in wins / in losses)
- Actions Taken With Cards: per-card Seen/Blocked/Pitched/Played table (sorted by Seen desc)
- Deck composition: card actions, pitch distribution, averages, cost dist, types, talents, keywords, rarity, 4-card hand probabilities

## Displaying Decks

When the user asks to see a deck or decklist, run `fabrary deck <id>` and output the result verbatim — do NOT reformat or summarize it. When the user says "show me the raw output", output the CLI result exactly as-is with no commentary.

## User Patterns

These are common ways the user asks for things — translate them to the right CLI invocation:

| User says | What to do |
|-----------|-----------|
| "show me deck X" / "fetch deck X" | `fabrary deck <id>` — output verbatim |
| "show me the decklist" | `fabrary deck <id> --decklist-only` |
| "show me the matchups" / "matchup guides" | `fabrary deck <id> --matchups-only` |
| "show me the stats" | `fabrary deck <id> --stats-only` |
| "show me the raw output" | Run the command, paste output exactly — no analysis |
| "top decks for X hero" | `fabrary top --hero <id> --format cc` |
| "decks in the last N days" | add `--days N` |
| "decks with results / matchups" | add `--has-results` / `--has-matchups` |
| "search for card X" | `fabrary cards search "<text>"` |
| "compare decks" | fetch each with `deck --decklist-only`, display both |

## APIs

**Algolia** — deck search (`public_decks` index), no auth required.
- Multi-query endpoint: `https://4e2ysy5y4i-dsn.algolia.net/1/indexes/*/queries`
- Direct object fetch: `https://4e2ysy5y4i-dsn.algolia.net/1/indexes/public_decks/<deckId>`
- API key: `63c7b6aa56d38399d37df3c341b982c3`, App ID: `4E2YSY5Y4I`

**AppSync GraphQL** — card search + deck results/matchups, requires Cognito auth token.
- Endpoint: `https://42xrd23ihbd47fjvsrt27ufpfe.appsync-api.us-east-2.amazonaws.com/graphql`
- Queries: `searchCards(text)`, `getResults(deckId)`, `getDeck(deckId)`
- Always use `getDeck` for card data — it returns the latest version. `getDeckVersions` returns stale versioned snapshots and should not be used.

**Cognito** — auth, token refresh.

## GameResult Fields

`getResults` returns per-game data:
- `result`: "Won" / "Lost" / "Draw"
- `source`: string | null (e.g. "FaBrary", "Talishar")
- `turns`: number | null
- `firstPlayer`: boolean | null (true = went first)
- `cardResults`: `{ cardIdentifier, blocked, pitched, played }[]` — per-card usage counts
- `seen` is computed client-side as `blocked + pitched + played`

## FabCard Fields

The `searchCards` GraphQL query returns:
`cardIdentifier`, `name`, `types`, `subtypes`, `rarity`, `pitch`, `cost`, `defense`, `power`, `keywords`, `classes`, `talents`, `fusions`, `artists`, `hero`, `young`, `specializations`, `restrictedFormats`, `setIdentifiers`, `defaultImage`, `specialImage`, `isCardBack`, `printings` (with `set`, `edition`, `foiling`, `rarity`, `treatment`, `treatments`, `artists`, `identifier`, `print`, `image`), `matchingPrintings`, `oppositeSideCard`.

## Known Limitations

- Algolia date fields are strings, so `--days` filtering is done client-side after fetch.
- GraphQL introspection is disabled on the AppSync endpoint.
- Inventory excludes cards where all sideboard copies are in the maybe list (`sideboardQuantity <= maybeQuantity`).
- Card names are derived from identifiers (slug → title case) so apostrophes are lost (e.g. `fyendals-spring-tunic` → "Fyendals Spring Tunic").
