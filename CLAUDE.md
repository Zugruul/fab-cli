# fabrary-cli

A CLI for searching Flesh & Blood cards and decks via fabrary.net, plus tournament coverage from fabtcg.com.

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
src/meta.ts         — Meta results from content.fabrary.net (hero win rates, period discovery)
src/fabtcg.ts       — fabtcg.com: events, tournament coverage, decklists, standings
```

## Dev & Install

```bash
npm i -g . --force   # install/reinstall globally (use --force to overwrite existing bin)
fab-cli --help
```

No build step — `bin/fab.js` registers tsx and requires `src/cli.ts` directly.

## CLI Structure

The binary is `fab-cli` with two top-level namespaces:

```
fab-cli fabrary <command>   # deck/card search and meta analysis via fabrary.net
fab-cli fabtcg  <command>   # official FAB TCG site: events, tournament coverage
```

## Auth

Credentials are stored at `~/.config/fabrary-search/config.json` (authToken, refreshToken, tokenExpiry).
Access tokens auto-refresh via the stored refresh token when within 5 minutes of expiry.

```bash
fab-cli fabrary login                  # interactive email + password login
fab-cli fabrary auth <raw-token>       # save a raw token manually (advanced)
```

## Commands

### Deck Search

```bash
fab-cli fabrary heroes [--filter <text>]
fab-cli fabrary formats
fab-cli fabrary search [--hero <id>] [--format <fmt>] [--days <n>] [--has-matchups] [--has-results] [-q <text>] [-n <limit>] [-p <page>]
fab-cli fabrary top   [--hero <id>] [--format <fmt>] [--days <n>] [--min-games <n>] [--source <src>] [-n <limit>] [--show <n>] [--sort games|winrate]
fab-cli fabrary deck <deckId>          # full deck: header + decklist + matchup guides + stats
fab-cli fabrary deck <deckId> --decklist-only
fab-cli fabrary deck <deckId> --matchups-only
fab-cli fabrary deck <deckId> --stats-only
fab-cli fabrary deck <deckId> --matchup <name>   # single matchup guide (partial name match)
fab-cli fabrary deck <deckId> --source <src>     # filter results by source (FaBrary, Talishar)
```

Format aliases: `cc` → Classic Constructed, `sa` → Silver Age, `blitz` → Blitz, `ll` → Living Legend, `upf` → Ultimate Pit Fight.

Hero identifiers use slug format, e.g. `vynnset-iron-maiden`, `prism-awakener-of-sol`.

### Card Search

```bash
fab-cli fabrary cards search "<text>" [flags]
fab-cli fabrary cards show "<text>"    # full detail for first match
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

### Meta Analysis

```bash
fab-cli fabrary meta [--format cc] [--period 30d|7d|YYYY-MM] [--hero <id>] [--show <n>]
fab-cli fabrary meta --list-periods          # show all valid time periods
fab-cli fabrary meta --hero oscilio-constella-intelligence   # matchup breakdown for one hero
```

```bash
fab-cli fabrary meta-shift [--format cc] [--ban <heroId>...] [--nerf <heroId>...] [--exclude <heroId>...] [--my-classes <class,...>] [--show <n>]
```

- Fetches both 7d and 30d data, computes momentum (`7d winRate − 30d winRate`)
- `--ban` removes a hero and re-weights affected matchups
- `--my-classes` filters output to heroes the user can play
- Useful for tournament prep (e.g. accounting for known bans)

Period aliases: `7d` → `last-7-days`, `30d` → `last-30-days`. Otherwise pass `YYYY-MM` or a season slug.

### fabtcg Events

```bash
fab-cli fabtcg events [--world-tour] [--upcoming] [--format <fmt>]
```

- `--world-tour`: Pro Tour, Calling, World Championship only
- `--upcoming`: future events only (after today)
- Scrapes `fabtcg.com/organised-play/`

### fabtcg Tournament Coverage

```bash
fab-cli fabtcg coverage <event>                  # show coverage index (rounds available, URL)
fab-cli fabtcg coverage <event> --round <n|final>  # standings for a specific round
fab-cli fabtcg coverage <event> --field            # hero field breakdown (counts + %)
fab-cli fabtcg coverage <event> --decklists        # list available decklists for the event
fab-cli fabtcg coverage <event> --player <name>    # show/fetch decklist for a specific player
fab-cli fabtcg coverage <event> --decklists --player <name>  # combined
```

`<event>` can be a slug (`pro-tour-yokohama`) or a human-readable name (`"pro tour yokohama"`).
The command auto-converts spaces to hyphens and falls back to WP API search if the slug doesn't resolve.

**Coverage index** shows:
- Available standing rounds (e.g. 1–15 + final)
- Available result rounds (e.g. 1–18)
- Coverage URL

**Decklists** are fetched from `fabtcg.com/decklists/` via the WordPress REST API. When a single decklist is found, it auto-fetches full card data and cross-references Fabrary (searches Algolia by player name + hero + format). Output shows:
- `fabtcg:` link to the official decklist
- `fabrary:` link to the Fabrary deck (if found)
- Equipment block + main deck grouped by pitch with pitch dots (● ●● ●●●)

**Format schedule** for coverage pages is visible at `fabtcg.com/coverage/<slug>/` — the article lists each round with its format (e.g. "Round 1 - Classic Constructed", "Round 6 - Silver Age").

## In-Session Tournament Analysis

When doing ad-hoc tournament analysis (path-to-top-8, opponent breakdown, etc.) that isn't built into the CLI, write a tsx script in the project root, run it with `npx tsx <script>.ts`, then delete it. Key patterns:

**Fetch round results:**
```typescript
// Results page HTML: <tr class="match-row"> blocks
// Each block has: player-1-cell, vs-cell (winner-pill), player-2-cell
// player name in <strong>, hero in <span>
const blocks = html.split('<tr class="match-row">').slice(1);
```

**Round format schedule** (e.g. Pro Tour Yokohama): fetch `fabtcg.com/coverage/<slug>/` and parse the article — it lists "Round N - Format" for every round.

**Typical Pro Tour structure**: 5 CC rounds → 6 SA rounds → 4 CC rounds → Top 8 (CC). Always verify from the event page.

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

When the user asks to see a deck or decklist, run `fab-cli fabrary deck <id>` and output the result verbatim — do NOT reformat or summarize it. When the user says "show me the raw output", output the CLI result exactly as-is with no commentary.

## User Patterns

These are common ways the user asks for things — translate them to the right CLI invocation:

| User says | What to do |
|-----------|-----------|
| "show me deck X" / "fetch deck X" | `fab-cli fabrary deck <id>` — output verbatim |
| "show me the decklist" | `fab-cli fabrary deck <id> --decklist-only` |
| "show me the matchups" / "matchup guides" | `fab-cli fabrary deck <id> --matchups-only` |
| "show me the stats" | `fab-cli fabrary deck <id> --stats-only` |
| "show me the raw output" | Run the command, paste output exactly — no analysis |
| "top decks for X hero" | `fab-cli fabrary top --hero <id> --format cc` |
| "decks in the last N days" | add `--days N` |
| "decks with results / matchups" | add `--has-results` / `--has-matchups` |
| "search for card X" | `fab-cli fabrary cards search "<text>"` |
| "compare decks" | fetch each with `deck --decklist-only`, display both |
| "meta for format X" | `fab-cli fabrary meta --format <fmt>` |
| "meta shift / ban analysis" | `fab-cli fabrary meta-shift --ban <heroId> --my-classes <...>` |
| "upcoming events / callings" | `fab-cli fabtcg events --world-tour --upcoming` |
| "coverage for event X" | `fab-cli fabtcg coverage "<event>"` |
| "field / hero breakdown for event X" | `fab-cli fabtcg coverage "<event>" --field` |
| "standings for round N" | `fab-cli fabtcg coverage "<event>" --round <n>` |
| "decklists for event X" | `fab-cli fabtcg coverage "<event>" --decklists` |
| "player X's deck at event Y" | `fab-cli fabtcg coverage "<event>" --player "<name>"` |
| "path to top 8 / player journey" | Write a tsx analysis script (see In-Session Tournament Analysis above) |

## APIs

**Algolia** — deck search (`public_decks` index), no auth required.
- Multi-query endpoint: `https://4e2ysy5y4i-dsn.algolia.net/1/indexes/*/queries`
- Direct object fetch: `https://4e2ysy5y4i-dsn.algolia.net/1/indexes/public_decks/<deckId>`
- API key: `63c7b6aa56d38399d37df3c341b982c3`, App ID: `4E2YSY5Y4I`
- `findFabraryDeck(playerName, heroIdentifier, format)` — cross-reference by player + hero + format

**AppSync GraphQL** — card search + deck results/matchups, requires Cognito auth token.
- Endpoint: `https://42xrd23ihbd47fjvsrt27ufpfe.appsync-api.us-east-2.amazonaws.com/graphql`
- Queries: `searchCards(text)`, `getResults(deckId)`, `getDeck(deckId)`
- Always use `getDeck` for card data — it returns the latest version. `getDeckVersions` returns stale versioned snapshots and should not be used.

**Cognito** — auth, token refresh.

**content.fabrary.net** — meta results JSON, no auth required.
- URL: `https://content.fabrary.net/results/all-{format}-{period}.json?today={DayName}-{Mon}-{DD}-{YYYY}-{HH}`
- Formats: `classic-constructed`, `silver-age`, `blitz`, `living-legend`, `ultimate-pit-fight`
- Periods: `last-7-days`, `last-30-days`, `YYYY-MM`, or season slugs
- JSON shape: `{ heroResults: [{ heroIdentifier, results: [{ opposingHeroIdentifier, plays, wins, ... }] }] }`

**fabtcg.com WordPress REST API** — tournament/decklist data, no auth required (browser headers required).
- Tournaments: `https://fabtcg.com/api/wp/v2/tournament?search=<name>`
- Decklists: `https://fabtcg.com/api/wp/v2/decklist?search=<keywords>&per_page=100`
- Single decklist: `https://fabtcg.com/api/wp/v2/decklist?slug=<slug>`
- Metadata in `cmb2.decklist_auto_fields`: `decklist_hero`, `decklist_player_name`, `decklist_event_name`
- Coverage pages: `https://fabtcg.com/coverage/<slug>/` — HTML has round-by-round results links
- Results pages: `https://fabtcg.com/coverage/<slug>/results/<round>/`
- Standings pages: `https://fabtcg.com/coverage/<slug>/standings/<round>/` and `/final-standings/`
- Requires full browser headers including `Referer: https://fabtcg.com/`

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

## Hero Data — Never Speculate

Never guess a hero's class, talent, or format legality (e.g. Living Legend rotation) from memory. Always rely on live data:
- Use `fab-cli fabrary cards search "<name> t:Hero"` or `getHeroIdentifiers()` for class/talent
- Use deck search results to infer what's active in a format
- Only make claims about heroes that the API data supports

## Known Limitations

- Algolia date fields are strings, so `--days` filtering is done client-side after fetch.
- GraphQL introspection is disabled on the AppSync endpoint.
- Inventory excludes cards where all sideboard copies are in the maybe list (`sideboardQuantity <= maybeQuantity`).
- Card names are derived from identifiers (slug → title case) so apostrophes are lost (e.g. `fyendals-spring-tunic` → "Fyendals Spring Tunic").
- fabtcg.com decklists are only published for top-performing players at major events; not all players have decklists.
- Pro Tour decklists include both CC and SA decks per player — `--player` will show a list when multiple exist.
