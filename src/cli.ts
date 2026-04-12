#!/usr/bin/env node
import { Command } from "commander";

const int = (v: string) => parseInt(v, 10);
import chalk from "chalk";
import { searchDecks, getFacets, getDeckById } from "./algolia";
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
} from "./display";
import type { HeroTopEntry, HeroGroup, ClassGroup } from "./display";
import { computeDeckStats, computeResultStats } from "./stats";
import { loadConfig, saveConfig, getAuthToken, getValidToken } from "./config";
import { loginWithPassword } from "./cognito";
import type { AlgoliaDeck, DeckWithStats, SearchOptions } from "./types";

const program = new Command();

program
  .name("fabrary")
  .description("FaBrary CLI — search Flesh & Blood decks and cards")
  .version("1.0.0");

// ─── auth ──────────────────────────────────────────────────────────────────

program
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

program
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

program
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

program
  .command("formats")
  .description("List all formats with deck counts")
  .action(async () => {
    const { formats } = await getFacets();
    printFormatsTable(formats);
  });

// ─── search ────────────────────────────────────────────────────────────────

program
  .command("search")
  .description("Search decks by filters")
  .option("--hero <id>", "Hero identifier (e.g. prism-awakener-of-sol)")
  .option("--format <format>", 'Format (e.g. "Classic Constructed", CC, Blitz, SA)')
  .option("--days <n>", "Only decks updated in the last N days", int)
  .option("--has-matchups", "Only decks with matchup guides")
  .option("--has-results", "Only decks with recorded results")
  .option("-q, --query <text>", "Text search (deck name, card name)")
  .option("-n, --limit <n>", "Max results", int, 20)
  .option("-p, --page <n>", "Page number (0-based)", int, 0)
  .action(async (opts: {
    hero?: string;
    format?: string;
    days?: number;
    hasMatchups?: boolean;
    hasResults?: boolean;
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

program
  .command("top")
  .description("Show top decks ranked by win rate (fetches results for each deck)")
  .option("--hero <id>", "Hero identifier (e.g. prism-awakener-of-sol)")
  .option("--format <format>", 'Format (e.g. "Classic Constructed", CC, Blitz, SA)')
  .option("--days <n>", "Only decks updated in the last N days", int)
  .option("--min-games <n>", "Minimum recorded games", int, 5)
  .option("--source <src>", "Filter by source (FaBrary, Talishar)")
  .option("-n, --limit <n>", "Max decks to fetch", int, 40)
  .option("--show <n>", "Max rows in output", int, 20)
  .option("--per-hero", "Show best win-rate and most-games deck per hero")
  .option("--top-n <n>", "Show top N decks per hero grouped together (implies --per-hero)", int)
  .option("--by-class", "Group --top-n output by class (fetches all hero class data)")
  .option("--class <name>", "Filter by hero class (e.g. Warrior, Ninja, Brute) — uses live card data")
  .option("--talent <name>", "Filter by hero talent (e.g. Shadow, Light, Ice) — uses live card data")
  .option("--young", "Include only young hero versions (default: adult only when --class/--talent used)")
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
        // Build hero groups sorted by best deck win rate
        const heroGroups: HeroGroup[] = [];
        for (const [, group] of byHero) {
          const sorted = group.slice().sort((a, b) => b.winRate - a.winRate).slice(0, opts.topN);
          heroGroups.push({ hero: group[0].hero, heroIdentifier: group[0].heroIdentifier, decks: sorted });
        }
        heroGroups.sort((a, b) => (b.decks[0]?.winRate ?? 0) - (a.decks[0]?.winRate ?? 0));

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
        .sort((a, b) => b.winRate - a.winRate)
        .slice(0, opts.show);
      printTopTable(sorted);
    }
  });

// ─── deck ──────────────────────────────────────────────────────────────────

program
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

const cardsCmd = program
  .command("cards")
  .description("Search Flesh & Blood cards");

cardsCmd
  .command("search <text...>")
  .description(
    'Search cards by text. Supports inline filters: r:Rarity, t:Type, k:Keyword\n' +
    '  Examples:\n' +
    '    fabrary cards search prism awakener\n' +
    '    fabrary cards search r:Majestic prism\n' +
    '    fabrary cards search vynnset t:Hero\n' +
    '    fabrary cards search vynnset --foiling Cold --set Promos'
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
      console.log(chalk.dim(`+${cards.length - 1} more results. Run 'fabrary cards search "${text}"' to see all.`));
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
    console.error(chalk.red("Not logged in. Run: fabrary login"));
    process.exit(1) as never;
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
        console.error(chalk.red("Session expired. Run: fabrary login"));
        process.exit(1) as never;
      }
      return await fn(fresh);
    }
    throw e;
  }
}

const FORMAT_ALIASES: Record<string, string> = {
  cc: "Classic Constructed",
  sa: "Silver Age",
  blitz: "Blitz",
  ll: "Living Legend",
  upf: "Ultimate Pit Fight",
  open: "Open",
  clash: "Clash",
};

function resolveFormat(f?: string): string | undefined {
  if (!f) return undefined;
  return FORMAT_ALIASES[f.toLowerCase()] ?? f;
}

function buildSearchOpts(opts: {
  hero?: string;
  format?: string;
  days?: number;
  hasMatchups?: boolean;
  hasResults?: boolean;
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
    query: opts.query,
    limit: opts.limit ?? 40,
    page: opts.page ?? 0,
  };
}

function filterByDays(decks: AlgoliaDeck[], days: number): AlgoliaDeck[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return decks.filter((d) => new Date(d.updatedAt).getTime() >= cutoff);
}

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});
