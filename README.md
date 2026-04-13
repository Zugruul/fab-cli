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

The CLI has two top-level namespaces:

```
fab-cli fabrary <command>   # deck/card search and meta analysis via fabrary.net
fab-cli fabtcg  <command>   # tournament coverage, events, decklists via fabtcg.com
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

## Tournament Coverage

### Events

```bash
fab-cli fabtcg events --world-tour --upcoming
```

### Coverage

```bash
# Index: what rounds are available
fab-cli fabtcg coverage "pro-tour-yokohama"

# Hero field breakdown
fab-cli fabtcg coverage "pro-tour-yokohama" --field

# Standings for a round
fab-cli fabtcg coverage "pro-tour-yokohama" --round 15
fab-cli fabtcg coverage "pro-tour-yokohama" --round final

# Published decklists (top 8 only)
fab-cli fabtcg coverage "pro-tour-yokohama" --decklists
fab-cli fabtcg coverage "pro-tour-yokohama" --decklists --player "Chanon Puttaree"

# Player's round-by-round journey
fab-cli fabtcg coverage "pro-tour-yokohama" --path "Andrew Cook"

# Find a player by partial name
fab-cli fabtcg coverage "pro-tour-yokohama" --search-player "cook"
```

Event names can be slugs (`pro-tour-yokohama`) or plain text (`"pro tour yokohama"`).

---

## Interesting Things to Try

### Who's winning and with what

```bash
# Top CC decks globally right now, sorted by win rate
fab-cli fabrary top --format cc --sort winrate --has-results

# Best Prism lists updated in the last 30 days
fab-cli fabrary top --hero prism-awakener-of-sol --format cc --sort winrate --days 30

# Most-played Oscilio decks with matchup guides
fab-cli fabrary top --hero oscilio-constella-intelligence --format cc --has-matchups --sort games
```

### Deep-dive a specific deck

```bash
# Full picture: list + matchup sideboard guides + game stats
fab-cli fabrary deck <id>

# How does this pilot's record break down by going first vs second?
fab-cli fabrary deck <id> --stats-only

# What cards does this pilot actually play, block, and pitch?
fab-cli fabrary deck <id> --stats-only
# → "Actions Taken With Cards" table shows seen/blocked/pitched/played per card
```

### Track a player through a tournament

```bash
# Full round-by-round journey with opponents and heroes
fab-cli fabtcg coverage "pro-tour-yokohama" --path "Franciszek Sapikowski"

# Dual-format events show CC and SA heroes separately,
# with a "Playing" column when heroes differ per round
fab-cli fabtcg coverage "pro-tour-yokohama" --path "Chanon Puttaree"

# Don't know the exact name? Search by partial name
fab-cli fabtcg coverage "pro-tour-yokohama" --search-player "puttaree"
```

### Hero field at an event

```bash
# What heroes showed up and in what numbers?
fab-cli fabtcg coverage "pro-tour-yokohama" --field
```

### Meta shift for a Calling

```bash
# How does the meta look if Oscilio's weapon gets banned?
fab-cli fabrary meta-shift --format cc --ban oscilio-constella-intelligence --my-classes guardian,illusionist,warrior,brute,wizard
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

fab-cli fabtcg events [--world-tour] [--upcoming] [--format <fmt>]
fab-cli fabtcg coverage <event> [--round <n|final>] [--field] [--decklists] [--player <name>] [--path <name>] [--search-player <name>]
```
