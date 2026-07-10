#!/usr/bin/env node
import { Command } from "commander";

const int = (v: string) => parseInt(v, 10);
import chalk from "chalk";
import { searchDecks, getFacets, getDeckById } from "./algolia";
import { resolveFormat } from "./format";
import { getDeckResults, getDeckVersionInfo, searchCards, getHeroIdentifiers, getHeroClassMap, computeWinRate, pLimit } from "./graphql";
import {
  printDecksTable,
  printTopTable,
  printGroupedTopTable,
  printClassGroupedTable,
  printPerHeroTable,
  printHeroesTable,
  printFormatsTable,
  printDeckDetail,
  printMatchupCards,
  printCardsTable,
  printCardDetail,
  printDeckStats,
  printMetaTable,
  printHeroMatchups,
  printMetaShiftTable,
  printMetaPeriods,
  printEventsTable,
  printCoverageIndex,
  printStandings,
  printFieldMeta,
  printDecklistMetas,
  printPlayerDecklist,
  printPlayerPath,
} from "./display";
import type { HeroTopEntry, HeroGroup, ClassGroup } from "./display";
import { fetchMetaPeriods, fetchMetaResults, computeMetaShift, resolveMetaFormat, resolveMetaPeriod } from "./meta";
import { fetchEvents, searchTournament, fetchCoverageIndex, fetchStandings, searchTournamentDecklists, fetchDecklistCards, fetchPlayerPath, searchPlayerInEvent, heroNameToIdentifier } from "./fabtcg";
import { findFabraryDeck } from "./algolia";
import { computeDeckStats, computeResultStats } from "./stats";
import { loadConfig, saveConfig, getAuthToken, getValidToken } from "./config";
import { loginWithPassword } from "./cognito";
import { ensureIndex, buildIndex, loadIndex, search as searchLore, findDoc, readDocBody, updateSubmodule } from "./lore";
import { updateRulesDocs, commitRulesDocs, RULES_DIR } from "./rulesDocs";
import type { AlgoliaDeck, DeckWithStats, SearchOptions } from "./types";

const program = new Command();

program
  .name("fab-cli")
  .description("FaBrary CLI — search Flesh & Blood decks, cards, and tournament events")
  .version("1.0.0");

const fabrary = program
  .command("fabrary")
  .description("Deck and card search via fabrary.net");

const fabtcg = program
  .command("fabtcg")
  .description("Official FAB TCG site data (events, organised play)");

// ─── auth ──────────────────────────────────────────────────────────────────

fabrary
  .command("auth <token>")
  .description("Save a raw Cognito access token (advanced — use 'fabrary login' instead)")
  .action((token: string) => {
    const cfg = loadConfig();
    cfg.authToken = token;
    delete cfg.refreshToken;
    delete cfg.tokenExpiry;
    saveConfig(cfg);
    console.log(chalk.green("Token saved."));
  });

fabrary
  .command("login")
  .description("Log in with your fabrary.net email and password")
  .option("-u, --username <email>", "Your fabrary.net email")
  .action(async (opts: { username?: string }) => {
    const readline = await import("readline");

    const ask = (prompt: string, hidden = false): Promise<string> =>
      new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        if (hidden) {
          // Write prompt manually and suppress echo
          process.stdout.write(prompt);
          process.stdin.setRawMode?.(true);
          let input = "";
          process.stdin.resume();
          process.stdin.setEncoding("utf8");
          const onData = (ch: string) => {
            if (ch === "\n" || ch === "\r" || ch === "\u0004") {
              process.stdin.setRawMode?.(false);
              process.stdin.pause();
              process.stdin.removeListener("data", onData);
              process.stdout.write("\n");
              rl.close();
              resolve(input);
            } else if (ch === "\u0003") {
              process.exit(0);
            } else if (ch === "\u007f" || ch === "\b") {
              input = input.slice(0, -1);
            } else {
              input += ch;
            }
          };
          process.stdin.on("data", onData);
        } else {
          rl.question(prompt, (answer) => {
            rl.close();
            resolve(answer.trim());
          });
        }
      });

    const username = opts.username ?? (await ask("Email: "));
    const password = await ask("Password: ", true);

    if (!username || !password) {
      console.error(chalk.red("Email and password are required."));
      process.exit(1);
    }

    process.stdout.write(chalk.dim("Logging in…\r"));
    try {
      const tokens = await loginWithPassword(username, password);
      const cfg = loadConfig();
      cfg.authToken = tokens.accessToken;
      cfg.refreshToken = tokens.refreshToken;
      cfg.tokenExpiry = tokens.expiresAt;
      saveConfig(cfg);
      process.stdout.write("             \r");
      console.log(chalk.green("Logged in. Token saved and will auto-refresh."));
    } catch (err: unknown) {
      process.stdout.write("             \r");
      console.error(chalk.red(`Login failed: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ─── heroes ────────────────────────────────────────────────────────────────

fabrary
  .command("heroes")
  .description("List all heroes with deck counts")
  .option("-f, --filter <text>", "Filter by partial hero name")
  .action(async (opts: { filter?: string }) => {
    process.stdout.write(chalk.dim("Loading heroes…\r"));
    const { heroes } = await getFacets();
    process.stdout.write("                  \r");
    printHeroesTable(heroes, opts.filter);
  });

// ─── formats ───────────────────────────────────────────────────────────────

fabrary
  .command("formats")
  .description("List all formats with deck counts")
  .action(async () => {
    const { formats } = await getFacets();
    printFormatsTable(formats);
  });

// ─── search ────────────────────────────────────────────────────────────────

fabrary
  .command("search")
  .description("Search decks by filters")
  .option("--hero <id>", "Hero identifier (e.g. prism-awakener-of-sol)")
  .option("--format <format>", 'Format (e.g. "Classic Constructed", CC, Blitz, SA)')
  .option("--days <n>", "Only decks updated in the last N days", int)
  .option("--has-matchups", "Only decks with matchup guides")
  .option("--has-results", "Only decks with recorded results")
  .option("--tournament-only", "Only tournament decks")
  .option("-q, --query <text>", "Text search (deck name, card name)")
  .option("-n, --limit <n>", "Max results", int, 20)
  .option("-p, --page <n>", "Page number (0-based)", int, 0)
  .action(async (opts: {
    hero?: string;
    format?: string;
    days?: number;
    hasMatchups?: boolean;
    hasResults?: boolean;
    tournamentOnly?: boolean;
    query?: string;
    limit: number;
    page: number;
  }) => {
    const searchOpts = buildSearchOpts(opts);
    process.stdout.write(chalk.dim("Searching…\r"));
    const result = await searchDecks(searchOpts);
    process.stdout.write("           \r");

    let decks = result.hits;
    if (opts.days) decks = filterByDays(decks, opts.days);

    printDecksTable(decks);
    if (result.nbPages > 1) {
      console.log(chalk.dim(`Page ${result.page + 1}/${result.nbPages} — use --page to navigate`));
    }
  });

// ─── top ───────────────────────────────────────────────────────────────────

fabrary
  .command("top")
  .description("Show top decks ranked by win rate (fetches results for each deck)")
  .option("--hero <id>", "Hero identifier (e.g. prism-awakener-of-sol)")
  .option("--format <format>", 'Format (e.g. "Classic Constructed", CC, Blitz, SA)')
  .option("--days <n>", "Only decks updated in the last N days", int)
  .option("--min-games <n>", "Minimum recorded games", int, 5)
  .option("--source <src>", "Filter by source (FaBrary, Talishar)")
  .option("--tournament-only", "Only tournament decks")
  .option("-n, --limit <n>", "Max decks to fetch", int, 40)
  .option("--show <n>", "Max rows in output", int, 20)
  .option("--per-hero", "Show best win-rate and most-games deck per hero")
  .option("--top-n <n>", "Show top N decks per hero grouped together (implies --per-hero)", int)
  .option("--by-class", "Group --top-n output by class (fetches all hero class data)")
  .option("--class <name>", "Filter by hero class (e.g. Warrior, Ninja, Brute) — uses live card data")
  .option("--talent <name>", "Filter by hero talent (e.g. Shadow, Light, Ice) — uses live card data")
  .option("--young", "Include only young hero versions (default: adult only when --class/--talent used)")
  .option("--sort <order>", "Sort order: winrate (default) or games", "winrate")
  .action(async (opts: {
    hero?: string;
    format?: string;
    days?: number;
    minGames: number;
    source?: string;
    limit: number;
    show: number;
    perHero?: boolean;
    topN?: number;
    byClass?: boolean;
    class?: string;
    talent?: string;
    young?: boolean;
    tournamentOnly?: boolean;
    sort: string;
  }) => {
    const isGrouped = opts.perHero || opts.topN !== undefined;
    const fetchLimit = isGrouped ? Math.max(opts.limit, 200) : opts.limit;
    const searchOpts = buildSearchOpts({ ...opts, hasResults: true, limit: fetchLimit });

    // Resolve class/talent filter to a set of hero identifiers via live card search
    let heroFilter: Set<string> | null = null;
    if (opts.class || opts.talent) {
      process.stdout.write(chalk.dim("Looking up heroes…\r"));
      heroFilter = await callWithToken((t) =>
        getHeroIdentifiers(t, {
          class: opts.class,
          talent: opts.talent,
          young: opts.young,
        })
      );
      if (heroFilter.size === 0) {
        console.log(chalk.yellow("No heroes found for that class/talent."));
        return;
      }
    }

    process.stdout.write(chalk.dim("Fetching deck list…\r"));
    const result = await searchDecks(searchOpts);
    let decks = result.hits;
    if (opts.days) decks = filterByDays(decks, opts.days);
    if (heroFilter) decks = decks.filter((d) => heroFilter!.has(d.heroIdentifier));

    if (decks.length === 0) {
      console.log(chalk.yellow("No decks found."));
      return;
    }

    process.stdout.write(chalk.dim(`Fetching results for ${decks.length} decks…\r`));

    let done = 0;
    const tasks = decks.map((deck) => async () => {
      const r = await callWithToken((t) => getDeckResults(t, deck.deckId));
      done++;
      process.stdout.write(chalk.dim(`Fetching results… ${done}/${decks.length}\r`));
      return { deck, results: r.results };
    });

    const fetched = await pLimit(tasks, 8);
    process.stdout.write("                                        \r");

    const withStats: DeckWithStats[] = fetched
      .map(({ deck, results }) => {
        const filtered = opts.source
          ? results.filter((r) => (r.source ?? "").toLowerCase() === opts.source!.toLowerCase())
          : results;
        const stats = computeWinRate(filtered);
        return { ...deck, ...stats };
      })
      .filter((d) => d.total >= opts.minGames);

    if (isGrouped) {
      // Group by heroIdentifier, sort each group by win rate
      const byHero = new Map<string, DeckWithStats[]>();
      for (const d of withStats) {
        const key = d.heroIdentifier;
        if (!byHero.has(key)) byHero.set(key, []);
        byHero.get(key)!.push(d);
      }

      if (opts.topN !== undefined) {
        const byGames = opts.sort === "games";
        // Build hero groups sorted by best deck win rate or games
        const heroGroups: HeroGroup[] = [];
        for (const [, group] of byHero) {
          const sorted = group.slice().sort((a, b) => byGames ? b.total - a.total : b.winRate - a.winRate).slice(0, opts.topN);
          heroGroups.push({ hero: group[0].hero, heroIdentifier: group[0].heroIdentifier, decks: sorted });
        }
        heroGroups.sort((a, b) => byGames
          ? (b.decks[0]?.total ?? 0) - (a.decks[0]?.total ?? 0)
          : (b.decks[0]?.winRate ?? 0) - (a.decks[0]?.winRate ?? 0));

        if (opts.byClass) {
          // Fetch hero→classes map and group heroGroups by class
          process.stdout.write(chalk.dim("Fetching hero class data…\r"));
          const heroClassMap = await callWithToken((t) => getHeroClassMap(t));
          process.stdout.write("                          \r");

          const classMap = new Map<string, HeroGroup[]>();
          for (const hg of heroGroups) {
            const classes = heroClassMap.get(hg.heroIdentifier) ?? ["Unknown"];
            for (const cls of classes) {
              if (!classMap.has(cls)) classMap.set(cls, []);
              classMap.get(cls)!.push(hg);
            }
          }

          const classGroups: ClassGroup[] = Array.from(classMap.entries())
            .map(([className, hgs]) => ({ className, heroGroups: hgs }))
            .sort((a, b) => {
              const aTop = a.heroGroups[0]?.decks[0]?.winRate ?? 0;
              const bTop = b.heroGroups[0]?.decks[0]?.winRate ?? 0;
              return bTop - aTop;
            });

          printClassGroupedTable(classGroups, opts.topN);
        } else {
          printGroupedTopTable(heroGroups);
        }
      } else {
        // --per-hero: one summary row per hero (best win rate + most games)
        const rows: HeroTopEntry[] = [];
        for (const [, group] of byHero) {
          const topWinRate = group.slice().sort((a, b) => b.winRate - a.winRate)[0] ?? null;
          const topGames   = group.slice().sort((a, b) => b.total - a.total)[0] ?? null;
          rows.push({ hero: group[0].hero, topWinRate, topGames });
        }
        rows.sort((a, b) => (b.topWinRate?.winRate ?? 0) - (a.topWinRate?.winRate ?? 0));
        printPerHeroTable(rows);
      }
    } else {
      const sorted = withStats
        .sort((a, b) => opts.sort === "games" ? b.total - a.total : b.winRate - a.winRate)
        .slice(0, opts.show);
      printTopTable(sorted);
    }
  });

// ─── deck ──────────────────────────────────────────────────────────────────

fabrary
  .command("deck <id>")
  .description("Show deck detail with win rate, card list, matchup guides, and stats")
  .option("--source <src>", "Filter results by source (FaBrary, Talishar)")
  .option("--matchup <name>", "Show cards for a specific matchup only (partial name match)")
  .option("--decklist-only", "Show only the decklist")
  .option("--matchups-only", "Show only per-matchup card lists")
  .option("--stats-only", "Show only stats")
  .action(async (id: string, opts: { source?: string; matchup?: string; decklistOnly?: boolean; matchupsOnly?: boolean; statsOnly?: boolean }) => {
    process.stdout.write(chalk.dim("Fetching deck…\r"));

    const [deck, resultsData, versionInfo] = await Promise.all([
      getDeckById(id),
      callWithToken((t) => getDeckResults(t, id)),
      callWithToken((t) => getDeckVersionInfo(t, id)),
    ]);
    const { typeMap } = versionInfo;
    process.stdout.write("               \r");

    if (!deck) {
      console.error(chalk.red(`Deck ${id} not found.`));
      process.exit(1);
    }

    const filteredResults = opts.source
      ? resultsData.results.filter(
          (r) => (r.source ?? "").toLowerCase() === opts.source!.toLowerCase()
        )
      : resultsData.results;

    const winRateStats = computeWinRate(filteredResults);
    const resultStats = computeResultStats(filteredResults);
    const deckStats = computeDeckStats(versionInfo.cards);

    const showAll = !opts.decklistOnly && !opts.matchupsOnly && !opts.statsOnly;

    // Single-matchup view
    if (opts.matchup) {
      const needle = opts.matchup.toLowerCase();
      const matchup = versionInfo.matchups.find((m) =>
        m.name.toLowerCase().includes(needle)
      );
      if (!matchup) {
        console.error(chalk.red(`No matchup found matching "${opts.matchup}".`));
        console.log(chalk.dim("Available: " + versionInfo.matchups.map((m) => m.name).join(", ")));
        process.exit(1);
      }
      const matchupCards = versionInfo.cards
        .map((c) => {
          const override = c.matchupQuantities?.find((mq) => mq.matchupId === matchup.matchupId);
          const qty = override !== undefined ? override.quantity : c.quantity;
          return { cardIdentifier: c.cardIdentifier, quantity: qty };
        })
        .filter((c) => c.quantity > 0);
      printDeckDetail(deck, winRateStats.total > 0 ? winRateStats : undefined, [matchup], matchupCards, versionInfo.inventoryCards, typeMap);
      return;
    }

    if (showAll || opts.decklistOnly) {
      printDeckDetail(deck, winRateStats.total > 0 ? winRateStats : undefined, versionInfo.matchups, versionInfo.cards, versionInfo.inventoryCards, typeMap);
    }
    if ((showAll || opts.matchupsOnly) && versionInfo.matchups.length > 0) {
      printMatchupCards(versionInfo.matchups, versionInfo.cards, versionInfo.inventoryCards);
    }
    if (showAll || opts.statsOnly) {
      printDeckStats(deck.name, deckStats, resultStats);
    }
  });

// ─── cards ─────────────────────────────────────────────────────────────────

const cardsCmd = fabrary
  .command("cards")
  .description("Search Flesh & Blood cards");

cardsCmd
  .command("local [terms...]")
  .description(
    "Offline card search over the vendored full card DB (third_party/flesh-and-blood-cards). No auth, no network.\n" +
      "Searches name + functional text by default; all terms must match (case-insensitive).\n" +
      "Examples:\n" +
      "  fab-cli fabrary cards local haze bending\n" +
      '  fab-cli fabrary cards local --text "spectral shield"     # cards MENTIONING it in text\n' +
      '  fab-cli fabrary cards local --exact "Spectral Shield"    # the card itself\n' +
      "  fab-cli fabrary cards local --keyword spectra --limit 50"
  )
  .option("--name", "match card names only")
  .option("--text", "match functional text only")
  .option("--keyword", "match card/granted keywords only")
  .option("--exact <name>", "exact (case-insensitive) name match")
  .option("--pitch <n>", "filter by pitch value")
  .option("--cost <n>", "filter by cost")
  .option("--type <type>", "filter by type/subtype/class (exact word, e.g. Aura, Ninja, Instant)")
  .option("--full", "print full JSON record(s)")
  .option("--limit <n>", "max results to show", "20")
  .action((terms: string[] = [], opts) => {
    const { searchLocalCards, CARD_DB_PATH } = require("./carddb") as typeof import("./carddb");
    if (terms.length === 0 && !opts.exact) {
      console.error(chalk.red("Provide search terms or --exact <name>."));
      process.exitCode = 1;
      return;
    }
    let results;
    try {
      results = searchLocalCards(terms, {
        scope: opts.name ? "name" : opts.text ? "text" : opts.keyword ? "keyword" : "any",
        exact: opts.exact,
        pitch: opts.pitch,
        cost: opts.cost,
        type: opts.type,
      });
    } catch (e: any) {
      console.error(chalk.red(e.message));
      process.exitCode = 2;
      return;
    }
    if (results.length === 0) {
      console.log(
        chalk.yellow(
          "NO MATCH — try fewer/partial terms or --text; fall back to `fab-cli fabrary cards search` (live) or cardvault.fabtcg.com"
        )
      );
      process.exitCode = 1;
      return;
    }
    const limit = parseInt(opts.limit, 10) || 20;
    console.log(chalk.dim(`${results.length} match(es) in ${CARD_DB_PATH}${results.length > limit ? ` (showing ${limit})` : ""}`));
    for (const c of results.slice(0, limit)) {
      if (opts.full) {
        console.log(JSON.stringify(c, null, 2));
        continue;
      }
      const stats = (["pitch", "cost", "power", "defense", "intelligence", "health"] as const)
        .filter((k) => c[k] !== undefined && c[k] !== null && String(c[k]) !== "")
        .map((k) => `${k} ${c[k]}`)
        .join(" · ");
      console.log(`\n${chalk.bold(c.name)}  ${chalk.cyan(`[${c.types.join(" ")}]`)}${stats ? chalk.dim("  " + stats) : ""}`);
      const txt = (c.functional_text ?? "").replace(/\n+/g, " ").trim();
      if (txt) console.log(`  ${txt.length > 300 ? txt.slice(0, 300) + "…" : txt}`);
    }
  });

cardsCmd
  .command("search <text...>")
  .description(
    'Search cards by text. Supports inline filters: r:Rarity, t:Type, k:Keyword\n' +
    '  Examples:\n' +
    '    fab-cli fabrary cards search prism awakener\n' +
    '    fab-cli fabrary cards search r:Majestic prism\n' +
    '    fab-cli fabrary cards search vynnset t:Hero\n' +
    '    fab-cli fabrary cards search vynnset --foiling Cold --set Promos'
  )
  .option("-d, --detail", "Show full detail for each card")
  .option("-n, --limit <n>", "Max results to show", int)
  .option("--foiling <foiling>", "Filter by foiling: Cold, Gold, Rainbow")
  .option("--treatment <treatment>", "Filter by art treatment: 'Alternate Art', 'Full Art', etc.")
  .option("--artist <artist>", "Filter by artist name (partial match)")
  .option("--set <set>", "Filter by set name (partial match)")
  .option("--spec <hero>", "Filter by specialization hero (e.g. Vynnset)")
  .option("--subtype <subtype>", "Filter by subtype (e.g. Attack, Young, 1H)")
  .option("--class <class>", "Filter by class (e.g. Runeblade, Ninja)")
  .option("--talent <talent>", "Filter by talent (e.g. Shadow, Light, Ice)")
  .option("--fusion <element>", "Filter by fusion (Earth, Ice, Lightning)")
  .option("--legal <format>", "Filter cards legal in format (e.g. CC, Blitz)")
  .option("--pitch <n>", "Filter by pitch value (1=red, 2=yellow, 3=blue)", int)
  .option("--cost <n>", "Filter by cost value", int)
  .option("--defense <n>", "Filter by defense value", int)
  .option("--power <n>", "Filter by power value", int)
  .action(async (words: string[], opts: {
    detail?: boolean;
    limit?: number;
    foiling?: string;
    treatment?: string;
    artist?: string;
    set?: string;
    spec?: string;
    subtype?: string;
    class?: string;
    talent?: string;
    fusion?: string;
    legal?: string;
    pitch?: number;
    cost?: number;
    defense?: number;
    power?: number;
  }) => {
    const filters: string[] = [];
    if (opts.foiling)              filters.push(`foiling:${opts.foiling}`);
    if (opts.treatment)            filters.push(`treatment:${opts.treatment}`);
    if (opts.artist)               filters.push(`artist:${opts.artist}`);
    if (opts.set)                  filters.push(`set:${opts.set}`);
    if (opts.spec)                 filters.push(`spec:${opts.spec}`);
    if (opts.subtype)              filters.push(`subtype:${opts.subtype}`);
    if (opts.class)                filters.push(`class:${opts.class}`);
    if (opts.talent)               filters.push(`talent:${opts.talent}`);
    if (opts.fusion)               filters.push(`fusion:${opts.fusion}`);
    if (opts.legal)                filters.push(`legal:${opts.legal}`);
    if (opts.pitch !== undefined)  filters.push(`pitch:${opts.pitch}`);
    if (opts.cost !== undefined)   filters.push(`cost:${opts.cost}`);
    if (opts.defense !== undefined) filters.push(`defense:${opts.defense}`);
    if (opts.power !== undefined)  filters.push(`power:${opts.power}`);

    const text = [...words, ...filters].join(" ");
    process.stdout.write(chalk.dim("Searching cards…\r"));
    const cards = await callWithToken((t) => searchCards(t, text));
    process.stdout.write("                  \r");

    const display = opts.limit ? cards.slice(0, opts.limit) : cards;
    if (opts.detail) {
      for (const c of display) printCardDetail(c);
    } else {
      printCardsTable(display);
    }
  });

cardsCmd
  .command("show <text...>")
  .description("Show full detail for a specific card (first match)")
  .action(async (words: string[]) => {
    const text = words.join(" ");
    process.stdout.write(chalk.dim("Searching…\r"));
    const cards = await callWithToken((t) => searchCards(t, text));
    process.stdout.write("           \r");
    if (cards.length === 0) {
      console.log(chalk.yellow("No cards found."));
      return;
    }
    printCardDetail(cards[0]);
    if (cards.length > 1) {
      console.log(chalk.dim(`+${cards.length - 1} more results. Run 'fab-cli fabrary cards search "${text}"' to see all.`));
    }
  });

// ─── meta ──────────────────────────────────────────────────────────────────

fabrary
  .command("meta")
  .description("Show hero win rates from the fabrary.net meta results matrix")
  .option("--format <fmt>", "Format (cc, sa, blitz, ll, upf)", "cc")
  .option("--period <period>", "Period: 7d, 30d, 2026-04, or a season slug", "30d")
  .option("--hero <id>", "Show matchup breakdown for a specific hero")
  .option("--show <n>", "Max heroes in output", int, 30)
  .option("--list-periods", "List all valid period slugs and exit")
  .action(async (opts: {
    format: string;
    period: string;
    hero?: string;
    show: number;
    listPeriods?: boolean;
  }) => {
    if (opts.listPeriods) {
      process.stdout.write(chalk.dim("Loading periods…\r"));
      const groups = await fetchMetaPeriods();
      process.stdout.write("                  \r");
      printMetaPeriods(groups);
      return;
    }

    const formatSlug = resolveMetaFormat(opts.format);
    const period = resolveMetaPeriod(opts.period);
    process.stdout.write(chalk.dim(`Fetching meta (${formatSlug}, ${period})…\r`));
    const rows = await fetchMetaResults(opts.format, opts.period);
    process.stdout.write("                                          \r");

    if (opts.hero) {
      const needle = opts.hero.toLowerCase();
      const match = rows.find((r) => r.hero.toLowerCase().includes(needle));
      if (!match) {
        console.log(chalk.yellow(`No hero found matching "${opts.hero}".`));
        console.log(chalk.dim("Available: " + rows.map((r) => r.hero).join(", ")));
        return;
      }
      printHeroMatchups(match);
    } else {
      printMetaTable(rows, opts.show);
    }
  });

fabrary
  .command("meta-shift")
  .description("Compare 7d vs 30d win rates to identify trending heroes")
  .option("--format <fmt>", "Format (cc, sa, blitz, ll, upf)", "cc")
  .option("--ban <ids>", "Comma-separated hero identifiers to treat as banned/removed")
  .option("--nerf <ids>", "Comma-separated hero identifiers with minor nerfs (~-6% WR)")
  .option("--exclude <ids>", "Comma-separated hero identifiers to hide from output")
  .option("--my-classes <classes>", "Comma-separated classes to filter heroes (e.g. guardian,warrior)")
  .option("--show <n>", "Max heroes in output", int, 20)
  .action(async (opts: {
    format: string;
    ban?: string;
    nerf?: string;
    exclude?: string;
    myClasses?: string;
    show: number;
  }) => {
    const ban     = opts.ban     ? opts.ban.split(",").map((s) => s.trim()) : [];
    const nerf    = opts.nerf    ? opts.nerf.split(",").map((s) => s.trim()) : [];
    const exclude = opts.exclude ? opts.exclude.split(",").map((s) => s.trim()) : [];
    const myClasses = opts.myClasses ? opts.myClasses.split(",").map((s) => s.trim().toLowerCase()) : [];

    process.stdout.write(chalk.dim("Fetching 7d and 30d meta data…\r"));
    let rows = await computeMetaShift({ format: opts.format, ban, nerf, exclude });
    process.stdout.write("                                \r");

    // Filter to user's classes via live card data if requested
    if (myClasses.length > 0) {
      process.stdout.write(chalk.dim("Looking up hero classes…\r"));
      const heroFilter = await callWithToken((t) =>
        getHeroIdentifiers(t, {})
      );
      // getHeroIdentifiers returns all heroes; we need class data
      const heroClassMap = await callWithToken((t) => getHeroClassMap(t));
      process.stdout.write("                          \r");

      rows = rows.filter((r) => {
        const classes = heroClassMap.get(r.hero) ?? [];
        return classes.some((c) => myClasses.includes(c.toLowerCase()));
      });
    }

    printMetaShiftTable(rows, { ban, myClasses, show: opts.show });
  });

// ─── fabtcg ────────────────────────────────────────────────────────────────

fabtcg
  .command("events")
  .description("Show upcoming organised play events from fabtcg.com")
  .option("--world-tour", "Only Pro Tour, Calling, and World Championship events")
  .option("--upcoming", "Only future events (after today)")
  .option("--format <fmt>", "Filter by format (partial match)")
  .option("--with-coverage", "Only events that have a live coverage page with results/standings")
  .option("--year <n>", "Fetch events from a specific year (e.g. 2025)")
  .action(async (opts: {
    worldTour?: boolean;
    upcoming?: boolean;
    format?: string;
    withCoverage?: boolean;
    year?: string;
  }) => {
    process.stdout.write(chalk.dim("Fetching events…\r"));
    const events = await fetchEvents({
      worldTour: opts.worldTour,
      upcoming: opts.upcoming,
      format: opts.format,
      withCoverage: opts.withCoverage,
      year: opts.year ? parseInt(opts.year) : undefined,
    });
    process.stdout.write("                  \r");
    printEventsTable(events);
  });

/** Fetch a decklist by slug, cross-reference Fabrary, and print it. */
async function fetchAndPrintDecklist(decklistSlug: string, knownFormat?: string | null): Promise<void> {
  const full = await fetchDecklistCards(decklistSlug);
  if (!full) {
    console.log(chalk.yellow("Could not fetch card data for decklist."));
    return;
  }

  // Attempt to find a matching deck on Fabrary
  const heroId = heroNameToIdentifier(full.hero);
  const format = full.format ?? knownFormat ?? "Classic Constructed";
  const fabraryMatch = await findFabraryDeck(full.player, heroId, format).catch(() => null);
  if (fabraryMatch) full.fabraryDeckId = fabraryMatch.deckId;

  printPlayerDecklist(full);
}

fabtcg
  .command("coverage <event>")
  .description("Tournament coverage: standings, hero field, decklists, player path")
  .option("--round <n>", "Show standings for a specific round (number or 'final')")
  .option("--field", "Show hero field breakdown from latest available standings")
  .option("--decklists", "List available decklists for the event")
  .option("--player <name>", "Show decklist for a specific player")
  .option("--path <name>", "Reconstruct a player's full round-by-round journey")
  .option("--search-player <name>", "Find a player by partial name match")
  .action(async (eventName: string, opts: {
    round?: string;
    field?: boolean;
    decklists?: boolean;
    player?: string;
    path?: string;
    searchPlayer?: string;
  }) => {
    process.stdout.write(chalk.dim("Searching tournament…\r"));

    // Resolve slug: try exact slug first, else search via WP API
    let slug = eventName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    try {
      // Try to fetch coverage index directly with the slug
      const idx = await fetchCoverageIndex(slug);
      process.stdout.write("                          \r");

      if (!opts.round && !opts.field && !opts.decklists && !opts.player && !opts.path && !opts.searchPlayer) {
        printCoverageIndex(idx);
        return;
      }

      if (opts.round) {
        const r = opts.round === "final" ? "final" : parseInt(opts.round);
        process.stdout.write(chalk.dim(`Fetching standings round ${opts.round}…\r`));
        const rows = await fetchStandings(slug, r);
        process.stdout.write("                                    \r");
        printStandings(rows, `${idx.title} — Round ${opts.round} Standings`);
      }

      if (opts.field) {
        // Use latest available standings round for field breakdown
        const latestRound = idx.standingRounds[idx.standingRounds.length - 1] ?? 1;
        process.stdout.write(chalk.dim(`Fetching field data (round ${latestRound})…\r`));
        const rows = await fetchStandings(slug, latestRound);
        process.stdout.write("                                          \r");
        printFieldMeta(rows);
      }

      if (opts.decklists) {
        process.stdout.write(chalk.dim("Fetching decklists…\r"));
        const decklists = await searchTournamentDecklists(slug, opts.player);
        process.stdout.write("                    \r");
        if (opts.player && decklists.length === 1) {
          await fetchAndPrintDecklist(decklists[0].slug, decklists[0].format);
        } else {
          printDecklistMetas(decklists);
        }
      }

      if (opts.player && !opts.decklists) {
        process.stdout.write(chalk.dim(`Fetching decklist for ${opts.player}…\r`));
        const decklists = await searchTournamentDecklists(slug, opts.player);
        process.stdout.write("                                    \r");
        if (decklists.length === 0) {
          console.log(chalk.yellow(`No decklists found for player "${opts.player}" at ${slug}`));
        } else if (decklists.length === 1) {
          await fetchAndPrintDecklist(decklists[0].slug, decklists[0].format);
        } else {
          console.log(chalk.dim(`Multiple decklists found for "${opts.player}":`));
          printDecklistMetas(decklists);
        }
      }

      if (opts.searchPlayer) {
        process.stdout.write(chalk.dim(`Searching for "${opts.searchPlayer}"…\r`));
        const matches = await searchPlayerInEvent(slug, opts.searchPlayer);
        process.stdout.write("                                    \r");
        if (matches.length === 0) {
          console.log(chalk.yellow(`No players found matching "${opts.searchPlayer}" at ${slug}`));
        } else if (matches.length === 1) {
          // Single match — auto-run path
          console.log(chalk.dim(`Found: ${matches[0].name}${matches[0].hero ? ` (${matches[0].hero})` : ""} — loading path…\n`));
          process.stdout.write(chalk.dim(`Building path for ${matches[0].name}…\r`));
          const path = await fetchPlayerPath(slug, matches[0].name);
          process.stdout.write("                                          \r");
          if (path) printPlayerPath(path);
          else console.log(chalk.yellow("No pairings found."));
        } else {
          console.log(chalk.dim(`\n  ${matches.length} players found matching "${opts.searchPlayer}":`));
          matches.forEach((m) =>
            console.log(`  ${chalk.bold(m.name)}${m.hero ? chalk.dim("  " + m.hero) : ""}`)
          );
          console.log(chalk.dim(`\n  Re-run with --path "<name>" to see full journey.`));
        }
      }

      if (opts.path) {
        process.stdout.write(chalk.dim(`Building path for ${opts.path}…\r`));
        const path = await fetchPlayerPath(slug, opts.path);
        process.stdout.write("                                          \r");
        if (!path) {
          console.log(chalk.yellow(`No pairings found for player "${opts.path}" at ${slug}`));
        } else {
          printPlayerPath(path);
        }
      }
    } catch {
      // Slug didn't work — try WP API search
      process.stdout.write(chalk.dim("Searching by name…   \r"));
      let tournaments;
      try {
        tournaments = await searchTournament(eventName);
      } catch (e2) {
        process.stdout.write("                     \r");
        console.error(chalk.red(`Could not find tournament "${eventName}": ${(e2 as Error).message}`));
        process.exit(1);
      }
      process.stdout.write("                     \r");

      if (tournaments.length === 0) {
        console.log(chalk.yellow(`No tournaments found matching "${eventName}"`));
        return;
      }
      if (tournaments.length > 1) {
        console.log(chalk.dim("Multiple tournaments found:"));
        tournaments.forEach((t, i) => console.log(`  ${i + 1}. ${t.title}  (${t.slug})`));
        console.log(chalk.dim("Re-run with the exact slug, e.g.:"));
        console.log(chalk.cyan(`  fab-cli fabtcg coverage "${tournaments[0].slug}"`));
        return;
      }
      // Exactly one match — recurse with slug
      slug = tournaments[0].slug;
      const idx = await fetchCoverageIndex(slug).catch(() => null);
      if (!idx) {
        console.log(chalk.yellow(`No coverage page found for "${tournaments[0].title}" (${slug})`));
        return;
      }
      printCoverageIndex(idx);
    }
  });

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Calls fn(token), auto-refreshing on 401 (e.g. when a browser session revoked
 * the stored token). Exits with an error message if not logged in at all.
 */
async function callWithToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  let token: string;
  try {
    token = await getValidToken();
  } catch {
    console.error(chalk.red("Not logged in. Run: fab-cli fabrary login"));
    return process.exit(1);
  }
  try {
    return await fn(token);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("401")) {
      let fresh: string;
      try {
        fresh = await getValidToken({ force: true });
      } catch {
        console.error(chalk.red("Session expired. Run: fab-cli fabrary login"));
        return process.exit(1);
      }
      return await fn(fresh);
    }
    throw e;
  }
}

function buildSearchOpts(opts: {
  hero?: string;
  format?: string;
  days?: number;
  hasMatchups?: boolean;
  hasResults?: boolean;
  tournamentOnly?: boolean;
  query?: string;
  limit?: number;
  page?: number;
}): SearchOptions {
  return {
    hero: opts.hero,
    format: resolveFormat(opts.format),
    days: opts.days,
    hasMatchups: opts.hasMatchups,
    hasResults: opts.hasResults,
    tournamentOnly: opts.tournamentOnly,
    query: opts.query,
    limit: opts.limit ?? 40,
    page: opts.page ?? 0,
  };
}

function filterByDays(decks: AlgoliaDeck[], days: number): AlgoliaDeck[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return decks.filter((d) => new Date(d.updatedAt).getTime() >= cutoff);
}

// ─── rules ─────────────────────────────────────────────────────────────────

const rules = program
  .command("rules")
  .description("Official FAB rules documents (CR, TRP, PPG) vendored in third_party/fab-rules");

rules
  .command("update-docs")
  .description("Redownload the vendored rules documents; replace only if validated (size + content sentinel), refresh VERSIONS.txt")
  .option("--commit", "Auto-commit third_party/fab-rules when a document actually changed")
  .action(async (opts: { commit?: boolean }) => {
    console.log(chalk.dim(`Updating ${RULES_DIR} …`));
    const results = await updateRulesDocs();
    for (const r of results) {
      const color = r.status === "failed" ? chalk.red : r.status === "updated" ? chalk.green : chalk.dim;
      console.log(`  ${color(r.status.padEnd(9))} ${r.file}  ${chalk.dim(r.detail)}${r.lastModified ? chalk.dim(`  (last-modified: ${r.lastModified})`) : ""}`);
    }
    if (results.some((r) => r.status === "failed")) process.exitCode = 1;
    if (opts.commit) {
      const hash = commitRulesDocs(results);
      console.log(hash ? chalk.green(`  committed ${hash}`) : chalk.dim("  nothing to commit"));
    } else if (results.some((r) => r.status === "updated")) {
      console.log(chalk.yellow("  documents changed — rerun with --commit to commit the update"));
    }
  });

// ─── lore ──────────────────────────────────────────────────────────────────

const lore = program
  .command("lore")
  .description("Flesh & Blood lore from legendarystories.net (fablore submodule)");

lore
  .command("sync")
  .description("Update the fablore submodule and rebuild the lore index + OKF files")
  .option("--no-update", "Skip pulling upstream; just rebuild from the current submodule")
  .option("--no-okf", "Skip writing OKF markdown files (index only)")
  .action((opts: { update: boolean; okf: boolean }) => {
    let offline: string | undefined;
    if (opts.update) {
      process.stdout.write(chalk.dim("Updating fablore submodule…\r"));
      const r = updateSubmodule();
      offline = r.error;
    }
    process.stdout.write(chalk.dim("Building lore index…              \r"));
    const index = buildIndex({ emitOkf: opts.okf });
    process.stdout.write("                                   \r");
    if (offline) console.log(chalk.yellow(`Could not pull upstream (${offline.split("\n")[0]}); used current submodule.`));
    else if (opts.update) console.log(chalk.green("Submodule up to date with upstream."));
    console.log(`Indexed ${chalk.bold(String(index.count))} lore documents @ ${chalk.dim(index.commit.slice(0, 7))}`);
    console.log(chalk.dim(`Index: lore/index.json${opts.okf ? "  ·  OKF: lore/**.md" : ""}`));
  });

lore
  .command("search <query...>")
  .description("Search the lore; results link to their legendarystories.net source")
  .option("-n, --limit <n>", "Max results", int, 8)
  .option("--no-sync", "Don't refresh the submodule (offline)")
  .option("--force-sync", "Refresh upstream now even if recently synced")
  .option("--include-archive", "Also search archive/ (older, possibly non-canon lore)")
  .action((parts: string[], opts: { limit: number; sync: boolean; forceSync?: boolean; includeArchive?: boolean }) => {
    const query = parts.join(" ");
    // Default: throttled auto-refresh (pull only if older than the TTL). --no-sync skips; --force-sync forces.
    const updateMode: boolean | "auto" = opts.sync === false ? false : opts.forceSync ? true : "auto";
    if (updateMode) process.stdout.write(chalk.dim("Refreshing lore…\r"));
    const { index, offline } = ensureIndex({ update: updateMode });
    process.stdout.write("                    \r");
    if (offline) console.log(chalk.yellow("(offline — searching last synced lore)\n"));
    const hits = searchLore(index, query, { limit: opts.limit, includeArchive: opts.includeArchive });
    if (!hits.length) { console.log(chalk.yellow(`No lore found for "${query}".`)); return; }
    const archiveNote = opts.includeArchive ? chalk.yellow("  ·  including archive (may be non-canon)") : chalk.dim("  ·  archive excluded (use --include-archive)");
    console.log(chalk.dim(`\n  ${hits.length} result(s) for "${query}"  ·  source: legendarystories.net`) + archiveNote + "\n");
    for (const h of hits) {
      console.log(`  ${chalk.bold(h.title)}  ${chalk.dim("[" + h.section + "]")}`);
      console.log(`  ${chalk.cyan(h.sourceUrl)}`);
      console.log(`  ${chalk.dim(h.snippet)}\n`);
    }
  });

lore
  .command("show <key...>")
  .description("Print a lore document (by path, slug, or title) + its source URL")
  .action((parts: string[]) => {
    const index = loadIndex();
    if (!index) { console.log(chalk.yellow("No index yet — run: fab-cli lore sync")); return; }
    const doc = findDoc(index, parts.join(" "));
    if (!doc) { console.log(chalk.yellow(`No lore page matching "${parts.join(" ")}".`)); return; }
    console.log(chalk.bold(`\n  ${doc.title}`));
    console.log(`  ${chalk.cyan(doc.sourceUrl)}\n`);
    console.log(readDocBody(doc.path));
  });

lore
  .command("list")
  .description("List lore documents")
  .option("-s, --section <name>", "Filter by section (e.g. heroes-of-rathe)")
  .option("-q, --filter <text>", "Filter by title substring")
  .option("--include-archive", "Include archive/ (older, possibly non-canon lore)")
  .action((opts: { section?: string; filter?: string; includeArchive?: boolean }) => {
    const index = loadIndex();
    if (!index) { console.log(chalk.yellow("No index yet — run: fab-cli lore sync")); return; }
    let docs = index.docs;
    if (!opts.includeArchive && opts.section !== "archive") docs = docs.filter((d) => d.section !== "archive");
    if (opts.section) docs = docs.filter((d) => d.section === opts.section);
    if (opts.filter) docs = docs.filter((d) => d.title.toLowerCase().includes(opts.filter!.toLowerCase()));
    for (const d of docs) console.log(`  ${chalk.bold(d.title)}  ${chalk.dim(d.path)}`);
    console.log(chalk.dim(`\n  ${docs.length} document(s)`));
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});
