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
src/cardvault.ts    — official Card Vault API: card search + TRUE text (authoritative per CR 2.0.2)
src/lore.ts         — F&B lore KB: index/search/OKF from the fablore submodule

scripts/best-decks-by-hero.ts — Reusable batch report: best N decks per hero for a format

third_party/fablore — git submodule: legendarystories.net source (mdBook markdown)
lore/               — generated OKF (markdown + frontmatter); index.json is git-ignored
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

**Hero slug lookup** — when a hero slug is unclear or returns no results, use:
```bash
fab-cli fabrary heroes --filter "<name>"   # lists all matching slugs + deck counts
```
Heroes have **young** (Blitz/SA) and **adult** (CC) versions with different slugs. Always use the adult slug for CC queries. Example: `puffin` (young, SA) vs `puffin-hightail` (adult, CC). The `heroes` command lists both variants.

**"Sage" = Silver Age (the user's shorthand for "SA").** When the user says "Sage" they mean the **Silver Age format** (`--format sa`), NOT a hero class — there is no Sage class (e.g. Enigma is class Illusionist / talent Mystic). Silver Age is a **young-hero-only format**, which is why "sage only uses young heroes." So "best Sage X decks" → use the young slug (`enigma`, not `enigma-ledger-of-ancestry`) with `--format sa`, and "heroes valid in Sage" → heroes with Silver Age play data (see `fab-cli fabrary meta --format sa`).

### Card Search

```bash
fab-cli fabrary cards search "<text>" [flags]
fab-cli fabrary cards show "<text>"    # full detail for first match
fab-cli fabrary cards local <terms...> # OFFLINE search of the full vendored card DB (no auth): name+text by default;
                                       # --exact "<Name>" (the card itself) vs --text "<phrase>" (cards mentioning it);
                                       # --keyword, --pitch/--cost/--type filters, --full for raw JSON, --limit N.
                                       # ALWAYS use this to confirm whether an unknown term is a card name.
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

### fabtcg Card Vault (TRUE text)

```bash
fab-cli fabtcg card "<name or text>"           # search + TRUE text + printed-text diff + legality
fab-cli fabtcg card --name snatch --pitch 1    # advanced filters (combinable)
fab-cli fabtcg card --class Illusionist --talent Lightning --subtype Aura --set OMN --list-only
fab-cli fabtcg card "<name>" --json            # raw detail record
```

- **Card Vault (cardvault.fabtcg.com) is the text authority per CR 2.0.2** — its True Text is the
  current authoritative wording; printings may carry older text (errata/re-templating).
- Output: true text, every distinct English printed wording that differs (with print IDs),
  rulings/errata count, per-format legality, and the cardvault URL.
- Reminder text (italic parentheticals) is ignored when diffing printed vs true text.
- Filters: `--name --text --pitch --cost --power --defense --talent --class --subtype --format --rarity --set --artist -n --list-only --json`.
- **Use this to double-check the true text of any card when precision matters** (adjudication,
  rulings, errata questions). The offline corpus (`cards local`) may lag behind errata.

### fabtcg Events

```bash
fab-cli fabtcg events [--world-tour] [--upcoming] [--with-coverage] [--format <fmt>]
```

- `--world-tour`: Pro Tour, Calling, World Championship only
- `--upcoming`: future events only (after today)
- `--with-coverage`: only events with a live coverage page containing real results/standings data; automatically searches current year + previous year pages
- `--year <n>`: fetch events from a specific year's page (e.g. `--year 2025`)
- Output includes a `Slug` column — use it directly: `fab-cli fabtcg coverage <slug>`
- Default fetches `fabtcg.com/organised-play/`; `--year` fetches `fabtcg.com/organised-play/{year}/`

### fabtcg Tournament Coverage

```bash
fab-cli fabtcg coverage <event>                        # show coverage index (rounds available, URL)
fab-cli fabtcg coverage <event> --round <n|final>      # standings for a specific round
fab-cli fabtcg coverage <event> --field                # hero field breakdown (counts + %)
fab-cli fabtcg coverage <event> --decklists            # list available decklists for the event
fab-cli fabtcg coverage <event> --player <name>        # show/fetch decklist for a specific player
fab-cli fabtcg coverage <event> --decklists --player <name>  # combined
fab-cli fabtcg coverage <event> --path <name>          # player's full round-by-round journey
fab-cli fabtcg coverage <event> --search-player <name> # find player by partial name (auto-runs --path if unique match)
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

**Dual-format events** are common at the Pro Tour level. Players bring two separate decks — one per format. The `--path` output accounts for this:
- The header shows each format's hero separately: `CC: Teklovossen, Esteemed Magnate` / `SA: Iyslander`
- When a player's hero changes across formats, a "Playing" column appears in the round table showing what they piloted each round
- `--search-player` uses round 1 (CC) pairings to find players — the hero shown there is their CC deck. Their SA deck appears in the path output.
- Pro Tour Yokohama (April 2025) was one of the first dual-format events with Silver Age. Format split: R1–5 CC → R6–11 SA → R12–18 CC → Top 8 CC.

## Batch Deck Analysis — Best Decks Per Hero

For "best N decks per hero valid in <format>" (e.g. "best 3 Sage decks per hero with win/loss/draw + games"), use the reusable script — do NOT hand-roll it each time:

```bash
npx tsx scripts/best-decks-by-hero.ts --format sa --min-games 30 --top 3 --out whatsapp
npx tsx scripts/best-decks-by-hero.ts --format sa --top 3 --out json   # raw data for further processing
```

- `--format` accepts the usual aliases (`cc`, `sa`/`sage`, `blitz`, `ll`, `upf`). Remember **"Sage" = Silver Age (`sa`)**.
- Heroes are derived from the Algolia `heroIdentifier` facet **within that format** (this is the correct "heroes valid in <format>" list — do NOT use meta-result slugs, which don't always match Algolia's `heroIdentifier`, e.g. `dorinthea` vs `dorinthea-ironsong`).
- Per deck it reports `W-L-D · win% · games`; `win% = wins/(wins+losses)`, draws excluded from win%. Default filter `--min-games 30` drops tiny-sample flukes; bump to `--min-games 100` to cut noise further.
- `--out whatsapp` emits plain text with `*bold*` hero names and links (no markdown tables) — paste-ready for WhatsApp, split into ~15–20-hero batches when sending.
- Heroes with no deck meeting `--min-games` are omitted from output.

**Rate limiting (AppSync WAF):** fetching results for hundreds of decks in a burst trips AWS WAF — you get `GraphQL HTTP error: 403` even with a **valid, unexpired** token. It is NOT a token/expiry problem (don't re-login). The script already mitigates with low concurrency (4), retry/backoff, and per-hero delays. If you still hit sustained 403s, the cooldown is a few minutes (~2–3 min observed) — probe a single `getDeckResults` in a loop until it succeeds, then re-run. Keep concurrency low; do not raise it.

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

**Typical Pro Tour structure**: 5 CC rounds → 6 SA rounds → 7 CC rounds → Top 8 (CC). Always verify from the event page.

**Dual-format events**: Players register two separate decklists — one per format. The results pages record which hero each player was piloting in each round, so `fetchRoundPairings` gives accurate per-round hero data. The `--path` command surfaces this automatically: if a player's hero differs between formats, the header shows both and a "Playing" column appears in the table. Silver Age was introduced at the Pro Tour level starting with Pro Tour Yokohama (2025).

**Finding all players of a specific hero at an event**: `--field` gives hero counts from standings but not player names. Use a tsx script fetching round 1 pairings and filtering by hero name. Note: large events have byes in round 1 (e.g. PT Yokohama had ~147 byes, so only 532/679 players appear in R1 pairings). Search rounds 1–5 in parallel to catch bye players:
```typescript
const rounds = [1,2,3,4,5];
const all = await Promise.all(rounds.map(r => fetchRoundPairings(slug, r)));
// deduplicate by player name, filter by hero substring
```

**Standings double-count in dual-format events**: `--field` pulls from standings HTML which lists players in CC and SA sections separately, inflating hero counts. Pairings are authoritative for unique player names. Always cross-check with pairings if counts seem off.

**Batch path analysis for a hero group**: Use a tsx script calling `fetchPlayerPath` in batches of ~5 to avoid overwhelming the server, then sort by `wins + draws*0.5` descending for ranking.

**Fabrary account lookup**: Use `fab-cli fabrary search -q "<player name>" [--format cc]` to find a player's Fabrary decks. Third-party accounts (e.g. FaBJPN, craziilegs) often upload tournament decklists on behalf of players who don't have their own accounts.

**Official fabtcg.com decklists are top 8 only**: Players outside the top 8 at major events have no published decklists on fabtcg.com. Fall back to Fabrary search by player name to find community-uploaded or self-uploaded lists.

**Deck comparison / meta evolution analysis**: Fetch multiple decklists with `--decklist-only`, then compare equipment slots, maindeck vs inventory counts, new cards vs cut cards. Key signals: cards moved from main to sideboard (meta adaptation), new set additions, deck size shifts (larger sideboard = more defined matchup-dependent tuning).

**Unlisted deck fetching**: Unlisted decks are not in Algolia (`fab-cli fabrary deck <id>` will fail with "not found"). They are still accessible via AppSync GraphQL with auth. Use a tsx script:
```typescript
import { getValidToken } from './src/config.ts';
const token = await getValidToken();
const res = await fetch('https://42xrd23ihbd47fjvsrt27ufpfe.appsync-api.us-east-2.amazonaws.com/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': token },
  body: JSON.stringify({ query: `query { getDeck(deckId: "<id>") { name heroIdentifier format deckCards { cardIdentifier quantity sideboardQuantity maybeQuantity } } }` })
});
```
Main deck = `deckCards` where `quantity > 0`. Inventory = `sideboardQuantity > maybeQuantity`.

**Deck similarity analysis**: To find which public deck is closest to a given list, fetch both via GraphQL, build a `Map<cardIdentifier, quantity>` for each main deck, then compute:
```typescript
// shared = sum of min(qA, qB) for each card
// similarity % = shared / max(totalCopiesA, totalCopiesB)
```
Sort candidates by similarity descending. Also output the diff (cards only in A, cards only in B) for the closest match. Use `Promise.all` to fetch all candidates in parallel.

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
| "true text of card X" / "official text" / "was card X errata'd" | `fab-cli fabtcg card "<name>"` — Card Vault true text + printed diff |
| "compare decks" | fetch each with `deck --decklist-only`, display both |
| "find similar decks to X" / "what's closest to this list" | fetch X via GraphQL (may be unlisted), fetch top N for that hero, run similarity script |
| "fetch / download this deck" (unlisted URL) | tsx script using `getDeck` via GraphQL with `getValidToken()` from `src/config.ts` |
| hero slug not found / no results | `fab-cli fabrary heroes --filter "<name>"` to find correct slug; check young vs adult variant |
| "meta for format X" | `fab-cli fabrary meta --format <fmt>` |
| "meta shift / ban analysis" | `fab-cli fabrary meta-shift --ban <heroId> --my-classes <...>` |
| "upcoming events / callings" | `fab-cli fabtcg events --world-tour --upcoming` |
| "events with coverage / what has results" | `fab-cli fabtcg events --world-tour --with-coverage` (searches current + previous year) |
| "events from 2025 / last year" | `fab-cli fabtcg events --year 2025 [--world-tour]` |
| "coverage for event X" | `fab-cli fabtcg coverage <slug>` — slug comes from `events` Slug column |
| "field / hero breakdown for event X" | `fab-cli fabtcg coverage "<event>" --field` |
| "standings for round N" | `fab-cli fabtcg coverage "<event>" --round <n>` |
| "decklists for event X" | `fab-cli fabtcg coverage "<event>" --decklists` |
| "player X's deck at event Y" | `fab-cli fabtcg coverage "<event>" --player "<name>"` |
| "path / journey for player X" | `fab-cli fabtcg coverage "<event>" --path "<name>"` |
| "find player X at event Y" | `fab-cli fabtcg coverage "<event>" --search-player "<name>"` (auto-runs path if unique) |
| "who played hero X at event Y" | tsx script: fetch R1–5 pairings, filter by hero name, deduplicate |
| "paths for all X players" | tsx script: `fetchPlayerPath` in batches, sort by record |
| "find player X on Fabrary" | `fab-cli fabrary search -q "<name>" [--format cc]` |
| "best Prism lists / top lists for hero X" | `fab-cli fabrary top --hero <id> --format cc --sort winrate [--days N]` |
| "compare these decks / meta evolution" | fetch each with `deck --decklist-only`, compare equipment + main + inventory |
| "best N decks per hero (valid) in <format>" / "best Sage decks per hero" | `npx tsx scripts/best-decks-by-hero.ts --format <fmt> --min-games 30 --top N --out whatsapp` (Sage = `sa`) |
| lore / story question ("who is X", "what is the Demonastery", "Arakni's origin") | `fab-cli lore search "<terms>"` + `lore show <page>`; answer ONLY from results, cite each `source_url`, never use memory |
| "Talishar lists for hero X" | `fab-cli fabrary top --hero <id> --source Talishar` — note: returns empty if those decks log no Talishar results |

## Vendored knowledge repos — keep them up to date (HARD RULE)

The repo vendors external knowledge under `third_party/`:
- `third_party/fablore` — legendarystories.net lore source (submodule)
- `third_party/flesh-and-blood-cards` — the-fab-cube full card database (submodule; json/english/card.json, 4800+ cards with functional text, keywords, types)
- `third_party/fab-rules/` — official rules documents (CR, TRP, PPG txt + VERSIONS.txt). Refresh with `fab-cli rules update-docs` — validates each download (size + content sentinel + not-an-HTML-error-page) before replacing, refreshes VERSIONS.txt, and only commits when `--commit` is passed AND a document actually changed. (`scripts/update-fab-rules.sh` is the bare-curl fallback.)

**Knowledge-flow hierarchy (HARD RULE):** the **judge brain** is the source of truth for rules/keyword knowledge. Player asks the judge when in doubt; the judge, when in doubt, consults the vendored documents and updates its own notes; the player learns from judge answers + play experience; **the judge never learns from the player** — player suggestions are only accepted after the judge confirms them against the real documents.

**Brains are the source of truth for answering; these vendored copies are the verification artifacts.** The player/judge identity brains (`.claude/identities/{player,judge}/brain/`) hold the digested, cited knowledge — answer from them, then double-check precision-sensitive claims against the vendored documents (the note's `source` cites the exact CR/TRP/PPG section).

**Keyword corpus (HARD RULE):** the `kw-*` notes + generated `keywords-index` are ONE physical copy living in the card-vault brain, symlinked (relative) into the judge and player brains — all brains read the same bytes. Editorial authority is the judge's; notes follow a strict template; the index is generated; NEVER write through a `kw-*` symlink outside judge editorial. Verify/repair with `python3 scripts/keyword-sync.py check|sync`; full template + protocol: `.claude/identities/KEYWORD-SYNC.md`.

**Before answering any question that draws on these sources (card text, card facts, lore), check freshness and update first** if the submodule hasn't been pulled in >24h: `git submodule update --remote third_party/<name>` (fablore has its own TTL auto-sync via `lore search`). Never answer card-text questions from model memory — read the card from the submodule. The submodule's `banned-*.json` files may be stale: **card legality ALWAYS comes from the live policy page** (https://fabtcg.com/rules-and-policy-center/card-legality-policy/), never from the submodule, cache, or memory. When bumping a submodule pin, commit the change.

## Lore (legendarystories.net / fablore)

Flesh & Blood story/lore lives in the **`third_party/fablore`** git submodule (the mdBook source behind https://legendarystories.net). `src/lore.ts` builds a retrieval index + OKF files from it; `fab-cli lore` exposes it.

```bash
fab-cli lore sync                       # force-update submodule + rebuild index + OKF (lore/**.md)
fab-cli lore sync --no-update           # rebuild from current submodule (offline)
fab-cli lore search <query...>          # search; auto-refreshes upstream if stale (>24h), prints source URLs
fab-cli lore search <query...> --force-sync  # refresh upstream now regardless of TTL
fab-cli lore search <query...> --no-sync     # search without any upstream refresh (offline)
fab-cli lore show <path|slug|title>     # print a lore page + its source URL
fab-cli lore list [--section <s>] [--filter <text>]
```

- Path → source URL mapping: `src/<rel>.md` → `https://legendarystories.net/<rel>.html`.
- **Periodic refresh:** `lore search` auto-pulls upstream **only when stale** — older than `SYNC_TTL_MS` (default 24h, override via env `FAB_LORE_TTL_MS`). Last-pull time is tracked in `lore/.sync-state.json` (git-ignored). So routine searches are instant/offline; the source of knowledge refreshes itself ~daily. `--force-sync` pulls now; `--no-sync` never pulls.
- **On install:** the `postinstall` hook (`scripts/postinstall.mjs`) runs `git submodule update --init --recursive`, so the fablore submodule is initialized/updated whenever the package is installed (best-effort; no-ops outside a git checkout). The index builds lazily on first `lore` command.
- OKF frontmatter: `title`, `source_url`, `section`, `headings`, `fablore_commit`. `lore/index.json` + `lore/.sync-state.json` are rebuildable caches (git-ignored).
- To bump the *committed* submodule pin: `fab-cli lore sync` then commit the submodule change.

**Invocation:** `fab-cli` is `npm link`ed to this repo, so `fab-cli lore …` and `node bin/fab.js lore …` run the same code — either works. Lore reads files relative to the repo (submodule + `lore/`), so run it from anywhere; it doesn't need auth. If `fab-cli` isn't on PATH in a given shell (e.g. a different nvm node version), fall back to `node bin/fab.js lore …` from the repo root.

### Answering lore questions — NEVER hallucinate, ALWAYS cite

When the user asks ANY Flesh & Blood story/lore/character/world question, do NOT answer from training-data memory — the F&B lore is niche and easy to get wrong. Always go through the local archive:

1. **Search**: `fab-cli lore search "<key terms from the question>"` (try a couple of term sets if the first is thin). Use `-n` to widen.
2. **Read the source**: `fab-cli lore show "<title-or-page>"` to read the full passage before asserting anything (snippets alone can mislead).
3. **Answer only from the returned text.** If the archive doesn't cover it, say "the Legendary Stories archive doesn't cover that" — do not fill gaps from memory.
4. **Cite the `source_url`** (the `legendarystories.net` link) for every claim/page you used.
5. Quote or closely paraphrase; if pages conflict or are ambiguous, surface that rather than silently resolving it.

**Avoid the `archive/` section unless the user allows it.** `archive/` holds older, superseded story that may no longer be canon. `lore search`/`lore list` exclude it by default. Do NOT answer from `archive/` pages or pass `--include-archive` unless the user explicitly asks for old/retired/legacy lore. If the current lore is silent but `archive/` has something, tell the user it only exists in the (possibly-outdated) archive and ask before using it — never cite an `archive/` URL as current canon.

Worked example — "What is the Demonastery?":
```bash
fab-cli lore search "Demonastery" -n 3
fab-cli lore show "demonastery"        # read the full page
```
→ Answer from that page's text, ending with: Source: https://legendarystories.net/world-of-rathe/demonastery.html

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

**Card Vault API** — official card DB with TRUE text, no auth, no browser-header spoofing needed.
- Search: `https://api.cardvault.fabtcg.com/carddb/api/v1/advanced-search/?q=<text>&page_size=60&page=1&orderby=relevance`
  - Filter params: `name`, `text`, `pitch`+`pitch_lookup=exact` (same for cost/power/defense/life/intellect), `talents`, `classes`, `subtype`, `legal_formats`, `rarities`, `set_code`, `product_name`, `artist_name`, `language`
  - Returns `printed_*` fields only + `card_id`/`print_id`
- Detail: `https://api.cardvault.fabtcg.com/carddb/api/v1/card_id/<card_id>/` (literal `card_id/` segment, trailing slash required)
  - `cores[].textbox` = TRUE text (`{br}` line breaks, `{r}`/`{d}`/`{p}` icons); `card_prints[]` per printing with `print_language` + `faces[].printed_rules_text`; `card_legality` per format; `rulings_errata[]`

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
- Unlisted decks are not in the Algolia `public_decks` index — `fab-cli fabrary deck <id>` fails with "not found". Use a GraphQL `getDeck` tsx script instead (auth required).
- Inventory excludes cards where all sideboard copies are in the maybe list (`sideboardQuantity <= maybeQuantity`).
- Card names are derived from identifiers (slug → title case) so apostrophes are lost (e.g. `fyendals-spring-tunic` → "Fyendals Spring Tunic").
- fabtcg.com decklists are only published for top 8 players at major events; non-top-8 players have no published list there. Fall back to `fab-cli fabrary search -q "<name>"`.
- Pro Tour decklists include both CC and SA decks per player — `--player` will show a list when multiple exist.
- `--field` hero counts come from standings HTML which double-counts players in dual-format events (CC + SA sections). Use pairings for accurate unique player counts.
- `--source Talishar` returns no results if the matching decks have no Talishar-sourced game results logged (common — most community decks log FaBrary tracker results only).
- Large events have byes in round 1; fetching only R1 pairings misses those players. Scan R1–5 in parallel to find all players of a given hero.
