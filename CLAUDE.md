# fabrary-cli

A CLI for searching Flesh & Blood cards and decks via fabrary.net.

## Project Structure

```
bin/fab.js          — Global entry point (uses tsx to run TypeScript directly, no build step)
src/cli.ts          — All commands and CLI logic (Commander.js)
src/algolia.ts      — Deck search via Algolia (public_decks index) + direct deck lookup by ID
src/graphql.ts      — Card search and deck results/matchups via AppSync GraphQL
src/display.ts      — Table and detail output (cli-table3 + chalk)
src/config.ts       — Auth token persistence (~/.config/fabrary-cli/config.json)
src/cognito.ts      — Cognito login + token refresh
src/types.ts        — Shared TypeScript interfaces
```

## Dev & Install

```bash
npm i -g . --force   # install/reinstall globally (use --force to overwrite existing bin)
fabrary --help
```

No build step ��� `bin/fab.js` registers tsx and requires `src/cli.ts` directly.

## Auth

Credentials are stored at `~/.config/fabrary-cli/config.json` (authToken, refreshToken, tokenExpiry).
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
fabrary deck <deckId>          # deck detail + win rate + matchup guides + card list
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

## FabCard Fields

The `searchCards` GraphQL query returns:
`cardIdentifier`, `name`, `types`, `subtypes`, `rarity`, `pitch`, `cost`, `defense`, `power`, `keywords`, `classes`, `talents`, `fusions`, `artists`, `hero`, `young`, `specializations`, `restrictedFormats`, `setIdentifiers`, `defaultImage`, `specialImage`, `isCardBack`, `printings` (with `set`, `edition`, `foiling`, `rarity`, `treatment`, `treatments`, `artists`, `identifier`, `print`, `image`), `matchingPrintings`, `oppositeSideCard`.

## Displaying Decks

When the user asks to see a deck or decklist, display it directly as formatted text — do NOT just run the CLI command and show terminal output. Format it as:

```
**Deck Name** — Hero (Format) | W-L (winrate%)

**Hero + Equipment (N)**
1x hero-identifier
...

**Main Deck (N)**
Nx card-identifier
...

**Inventory (N)**
Nx card-identifier
...
```

## Known Limitations

- Algolia date fields are strings, so `--days` filtering is done client-side after fetch.
- GraphQL introspection is disabled on the AppSync endpoint.
- Inventory excludes cards where all sideboard copies are in the maybe list (sideboardQuantity <= maybeQuantity).
