# fab-cli

A command-line tool for Flesh & Blood TCG research. Search decks and cards via [fabrary.net](https://fabrary.net), explore tournament coverage from [fabtcg.com](https://fabtcg.com), and analyse the meta.

## Install

Requires [Node.js](https://nodejs.org) 18+.

```bash
git clone https://github.com/Zugruul/fab-cli.git
cd fab-cli
npm install
npm install -g . --force
```

Verify:

```bash
fab-cli --help
```

No build step required — runs TypeScript directly via `tsx`.

### Updating

```bash
git pull
npm install -g . --force
```

---

## Quick Start

The CLI has three top-level namespaces:

```
fab-cli fabrary          <command>   # deck/card search and meta analysis via fabrary.net
fab-cli fabtcg           <command>   # tournament coverage, events, decklists via fabtcg.com
fab-cli price-comparison <command>   # TCGplayer vs Cardmarket price comparison
```

---

## Deck Search

Find top-performing decks for a hero:

```bash
fab-cli fabrary top --hero prism-awakener-of-sol --format cc
fab-cli fabrary top --hero arakni-marionette --format cc --sort winrate
fab-cli fabrary top --hero victor-goldmane-high-and-mighty --format cc --days 30
```

Search by keyword or player name:

```bash
fab-cli fabrary search -q "Andrew Cook" --format cc
fab-cli fabrary search --hero oscilio-constella-intelligence --has-results
```

View a full deck (decklist + matchup guides + stats):

```bash
fab-cli fabrary deck 01JRX3FA3MD3NH6F0QVZ1D7QSS
fab-cli fabrary deck 01JRX3FA3MD3NH6F0QVZ1D7QSS --decklist-only
fab-cli fabrary deck 01JRX3FA3MD3NH6F0QVZ1D7QSS --matchups-only
fab-cli fabrary deck 01JRX3FA3MD3NH6F0QVZ1D7QSS --stats-only
```

The deck ID is the last segment of any `fabrary.net/decks/` URL.

### Format aliases

| Alias | Format |
|-------|--------|
| `cc` | Classic Constructed |
| `sa` | Silver Age |
| `blitz` | Blitz |
| `ll` | Living Legend |
| `upf` | Ultimate Pit Fight |

### Hero slug lookup

Hero slugs use lowercase hyphenated format. If you're unsure:

```bash
fab-cli fabrary heroes --filter "prism"
fab-cli fabrary heroes --filter "arakni"
```

Heroes have young (Blitz/SA) and adult (CC) versions with different slugs — the `heroes` command lists both.

---

## Card Search

```bash
fab-cli fabrary cards search "wartune herald"
fab-cli fabrary cards search "prism r:Majestic"
fab-cli fabrary cards search "attack t:Action k:Dominate"
fab-cli fabrary cards show "arc light sentinel"
```

Filter flags:

| Flag | Example |
|------|---------|
| `--class` | `--class Illusionist` |
| `--talent` | `--talent Light` |
| `--pitch` | `--pitch 1` (red), `--pitch 3` (blue) |
| `--cost` | `--cost 0` |
| `--power` | `--power 4` |
| `--defense` | `--defense 3` |
| `--set` | `--set "Dusk till Dawn"` |
| `--rarity` | via inline `r:Majestic` |
| `--treatment` | `--treatment "Full Art"` |
| `--foiling` | `--foiling Rainbow` |
| `--legal` | `--legal cc` |
| `-d` | Full card detail view |

---

## Meta Analysis

Current hero win rates:

```bash
fab-cli fabrary meta --format cc
fab-cli fabrary meta --format cc --period 7d
fab-cli fabrary meta --format cc --period 2026-04
fab-cli fabrary meta --list-periods
```

Matchup breakdown for a specific hero:

```bash
fab-cli fabrary meta --format cc --hero oscilio-constella-intelligence
```

Meta shift + ban analysis (tournament prep):

```bash
fab-cli fabrary meta-shift --format cc --ban oscilio-constella-intelligence
fab-cli fabrary meta-shift --format cc --ban oscilio-constella-intelligence --my-classes guardian,illusionist,warrior,brute
```

---

## Card Vault (official true text)

The official [Card Vault](https://cardvault.fabtcg.com/) is the text authority for cards
(CR 2.0.2): its **True Text** is the current authoritative wording, which can differ from
what's printed on any given printing (errata, re-templating).

```bash
# Search + true text, printed-text diff, and per-format legality
fab-cli fabtcg card "phantasmal footsteps"

# Advanced filters (all optional, combinable)
fab-cli fabtcg card --name snatch --pitch 1
fab-cli fabtcg card --class Illusionist --talent Lightning --subtype Aura
fab-cli fabtcg card --set MON --rarity legendary --list-only
fab-cli fabtcg card "command and conquer" --json   # raw detail record
```

Shows: true text, printed text when it differs, rulings/errata count, and legality per
format straight from the Card Vault API.

---

## Price Comparison

Compare Flesh & Blood single-card prices across [TCGplayer](https://www.tcgplayer.com/) (USD)
and [Cardmarket](https://www.cardmarket.com/) (EUR), per printing and per condition, plus
cross-marketplace ratio tables so you can see where a card is cheaper and by how much.

```bash
# Full comparison: 4 pages — TCGplayer prices, Cardmarket prices, and a ratio
# table in each direction (TCGplayer/Cardmarket and Cardmarket/TCGplayer)
fab-cli price-comparison card "fyendals spring tunic"

# Emit the same data as CSV instead of tables
fab-cli price-comparison card "fyendals spring tunic" --csv
fab-cli price-comparison card "fyendals spring tunic" --csv output.csv

# Bypass the disk cache and re-fetch live
fab-cli price-comparison card "fyendals spring tunic" --refresh

# Convert ratio tables to EUR instead of the default USD
fab-cli price-comparison card "fyendals spring tunic" --currency eur
```

An empty cell (`—`) means no real price was found for that condition on that marketplace —
the tool never fabricates or estimates a price to fill a gap, so what you see is always a
real observed value.

Condition columns are always **NM, SP/LP, MP, HP** (Near Mint → Heavily Played). Cardmarket
doesn't publish per-condition prices, so all four of its columns use the same price-guide
`low` value, with a separate reference-only `Trend` column alongside them (not used in ratio
math).

Export the full catalog (or a subset) to CSV for offline analysis:

```bash
# Full FAB singles catalog — can take a while; --set is recommended for a quick test
fab-cli price-comparison export

# Just one or a few sets
fab-cli price-comparison export --set "Dusk till Dawn"
fab-cli price-comparison export --set "Dusk till Dawn" --set "Heavy Hitters"

# Custom output directory, EUR ratio pages, force refresh
fab-cli price-comparison export --out ./prices/ --currency eur --refresh
```

`export` writes 5 files: `prices-tcgplayer.csv`, `prices-cardmarket.csv`,
`ratio-tcgplayer-cardmarket.csv`, `ratio-cardmarket-tcgplayer.csv`, and `unmatched.csv`
(rows that couldn't be priced or matched across marketplaces, with a reason).

## Tournament Coverage

### Events

```bash
# All world-tour events (Pro Tour, Calling, Worlds)
fab-cli fabtcg events --world-tour

# Only upcoming events
fab-cli fabtcg events --world-tour --upcoming

# Only events that already have a live coverage page with results/standings
# Searches current year + previous year automatically
fab-cli fabtcg events --world-tour --with-coverage

# Events from a specific year
fab-cli fabtcg events --year 2025
fab-cli fabtcg events --world-tour --year 2025
```

The `Slug` column in the output can be used directly with the `coverage` command.

### Coverage

First, find events with coverage:

```bash
fab-cli fabtcg events --world-tour --with-coverage
# → shows slug column, e.g. "pro-tour-yokohama", "calling-shanghai"
```

Then use the slug:

```bash
# Index: what rounds and data are available
fab-cli fabtcg coverage pro-tour-yokohama

# Hero field breakdown (who brought what)
fab-cli fabtcg coverage pro-tour-yokohama --field

# Standings at a specific round
fab-cli fabtcg coverage pro-tour-yokohama --round 15
fab-cli fabtcg coverage pro-tour-yokohama --round final

# Published decklists (top 8 only)
fab-cli fabtcg coverage pro-tour-yokohama --decklists
fab-cli fabtcg coverage pro-tour-yokohama --decklists --player "Chanon Puttaree"

# Player's full round-by-round journey (opponent + result every round)
fab-cli fabtcg coverage pro-tour-yokohama --path "Andrew Cook"

# Don't know the exact name? Search by partial
fab-cli fabtcg coverage pro-tour-yokohama --search-player "cook"
# → if unique match, auto-shows their full path
```

Event names can be slugs (`pro-tour-yokohama`) or plain text (`"pro tour yokohama"`). Spaces are auto-converted to hyphens.

**Note:** Coverage standings and the `--path` command only cover Swiss rounds. Top-cut bracket results (top 8/4/2) are not published on fabtcg.com results pages.

---

## Interesting Things to Try

### Discover what events have live coverage right now

```bash
fab-cli fabtcg events --world-tour --with-coverage
# → only shows events with real standings/results data published
# → use the Slug column directly: fab-cli fabtcg coverage <slug>
```

### Who's winning and with what

```bash
# Top CC decks globally right now, sorted by win rate
fab-cli fabrary top --format cc --sort winrate --has-results

# Best Prism lists updated in the last 30 days
fab-cli fabrary top --hero prism-awakener-of-sol --format cc --sort winrate --days 30

# Most-played Oscilio decks with matchup guides
fab-cli fabrary top --hero oscilio-constella-intelligence --format cc --has-matchups --sort games

# Find a player's decks on Fabrary by name
fab-cli fabrary search -q "Andrew Cook" --format cc
```

### Deep-dive a specific deck

```bash
# Full picture: decklist + matchup sideboard guides + game stats
fab-cli fabrary deck 01JRX3FA3MD3NH6F0QVZ1D7QSS

# Just the decklist
fab-cli fabrary deck 01JRX3FA3MD3NH6F0QVZ1D7QSS --decklist-only

# Just the matchup guides (what to swap in/out per opponent)
fab-cli fabrary deck 01JRX3FA3MD3NH6F0QVZ1D7QSS --matchups-only

# Game stats: going first vs second, avg turns, card usage breakdown
fab-cli fabrary deck 01JRX3FA3MD3NH6F0QVZ1D7QSS --stats-only

# One specific matchup guide
fab-cli fabrary deck 01JRX3FA3MD3NH6F0QVZ1D7QSS --matchup "oscilio"
```

### Track a player through a tournament

```bash
# Full round-by-round journey: opponents, heroes, results
fab-cli fabtcg coverage pro-tour-yokohama --path "Franciszek Sapikowski"

# At dual-format events (CC + SA), the header shows both heroes
# and a "Playing" column appears per round showing what they piloted
fab-cli fabtcg coverage pro-tour-yokohama --path "Chanon Puttaree"

# Don't know the exact name? Partial search — auto-runs path if unique match
fab-cli fabtcg coverage pro-tour-yokohama --search-player "puttaree"
```

### Hero field and standings at an event

```bash
# Who brought what — hero counts and percentages
fab-cli fabtcg coverage pro-tour-yokohama --field

# Final standings
fab-cli fabtcg coverage pro-tour-yokohama --round final

# Mid-swiss standings (e.g. after round 10)
fab-cli fabtcg coverage pro-tour-yokohama --round 10
```

### Prepare for a specific matchup

```bash
# What does Prism's matchup spread look like right now?
fab-cli fabrary meta --format cc --hero prism-awakener-of-sol

# What's Prism's win rate vs Arakni specifically?
# → shown in the matchup table from the above command

# Who are the top Arakni players on Fabrary and how do their lists differ?
fab-cli fabrary top --hero arakni-marionette --format cc --sort winrate --days 30
```

### Meta shift for a Calling

```bash
# How does the meta look if Oscilio's weapon gets banned?
fab-cli fabrary meta-shift --format cc --ban oscilio-constella-intelligence

# Filter to only heroes you can play
fab-cli fabrary meta-shift --format cc --ban oscilio-constella-intelligence --my-classes guardian,illusionist,warrior,brute,wizard

# Period comparison: 7d trend vs 30d baseline
fab-cli fabrary meta --format cc --period 7d   # recent
fab-cli fabrary meta --format cc --period 30d  # baseline
```

### Card collection research

```bash
# All Majestic Light cards legal in CC
fab-cli fabrary cards search "t:Action --talent Light --legal cc r:Majestic"

# Every full art printing of a card
fab-cli fabrary cards search "fyendals spring tunic" --treatment "Full Art"

# Rainbow foil cards from a specific set
fab-cli fabrary cards search "t:Equipment --set 'Dusk till Dawn' --foiling Rainbow" -d
```

---

## Auth (optional)

Some features (deck results, matchup guides) require a Fabrary account. Login with:

```bash
fab-cli fabrary login
```

Or save a token directly:

```bash
fab-cli fabrary auth <your-token>
```

Tokens are stored at `~/.config/fabrary-search/config.json` and auto-refresh.

---

## All Commands

```
fab-cli fabrary heroes [--filter <text>]
fab-cli fabrary formats
fab-cli fabrary search [--hero <id>] [--format <fmt>] [--days <n>] [--has-matchups] [--has-results] [-q <text>] [-n <limit>]
fab-cli fabrary top [--hero <id>] [--format <fmt>] [--days <n>] [--min-games <n>] [--source <src>] [-n <limit>] [--show <n>] [--sort games|winrate]
fab-cli fabrary deck <id> [--decklist-only] [--matchups-only] [--stats-only] [--matchup <name>]
fab-cli fabrary cards search "<text>" [flags]
fab-cli fabrary cards show "<text>"
fab-cli fabrary meta [--format <fmt>] [--period <period>] [--hero <id>] [--show <n>] [--list-periods]
fab-cli fabrary meta-shift [--format <fmt>] [--ban <id>...] [--nerf <id>...] [--exclude <id>...] [--my-classes <list>] [--show <n>]
fab-cli fabrary login
fab-cli fabrary auth <token>

fab-cli fabtcg events [--world-tour] [--upcoming] [--with-coverage] [--year <n>] [--format <fmt>]
fab-cli fabtcg coverage <slug> [--round <n|final>] [--field] [--decklists] [--player <name>] [--path <name>] [--search-player <name>]

fab-cli price-comparison card <name> [--csv [file]] [--refresh] [--currency usd|eur]
fab-cli price-comparison export [--set <name...>] [--out <dir>] [--refresh] [--currency usd|eur]
```
