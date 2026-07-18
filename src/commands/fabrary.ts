import { Command } from "commander";
import chalk from "chalk";
import { searchDecks, getFacets, getDeckById } from "../algolia";
import { resolveFormat } from "../format";
import {
  getDeckResults,
  getDeckVersionInfo,
  getHeroIdentifiers,
  getHeroClassMap,
  computeWinRate,
  pLimit,
} from "../graphql";
import type { DeckCard } from "../graphql";
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
  printDeckStats,
  printMetaTable,
  printHeroMatchups,
  printMetaShiftTable,
  printMetaPeriods,
} from "../display";
import type { HeroTopEntry, HeroGroup, ClassGroup } from "../display";
import {
  fetchMetaPeriods,
  fetchMetaResults,
  computeMetaShift,
  resolveMetaFormat,
  resolveMetaPeriod,
} from "../meta";
import { computeDeckStats, computeResultStats } from "../stats";
import { loadConfig, saveConfig } from "../config";
import { loginWithPassword } from "../cognito";
import type { AlgoliaDeck, DeckWithStats, SearchOptions } from "../types";
import {
  int,
  callWithToken,
  wantsJson,
  printJson,
  progressWrite,
} from "./util";
import { registerCards } from "./cards";

export function registerFabrary(program: Command): Command {
  const fabrary = program
    .command("fabrary")
    .description("Deck and card search via fabrary.net");

  // ─── auth ──────────────────────────────────────────────────────────────

  fabrary
    .command("auth <token>")
    .description(
      "Save a raw Cognito access token (advanced — use 'fabrary login' instead)",
    )
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
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
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
        console.log(
          chalk.green("Logged in. Token saved and will auto-refresh."),
        );
      } catch (err: unknown) {
        process.stdout.write("             \r");
        console.error(chalk.red(`Login failed: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ─── heroes ────────────────────────────────────────────────────────────

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

  // ─── formats ───────────────────────────────────────────────────────────

  fabrary
    .command("formats")
    .description("List all formats with deck counts")
    .action(async () => {
      const { formats } = await getFacets();
      printFormatsTable(formats);
    });

  // ─── search ────────────────────────────────────────────────────────────

  fabrary
    .command("search")
    .description("Search decks by filters")
    .option("--hero <id>", "Hero identifier (e.g. prism-awakener-of-sol)")
    .option(
      "--format <format>",
      'Format (e.g. "Classic Constructed", CC, Blitz, SA)',
    )
    .option("--days <n>", "Only decks updated in the last N days", int)
    .option("--has-matchups", "Only decks with matchup guides")
    .option("--has-results", "Only decks with recorded results")
    .option("--tournament-only", "Only tournament decks")
    .option(
      "-q, --query <text>",
      "Text search (deck name, author, hero, card name)",
    )
    .option(
      "--latest-search <text>",
      "Alias for --query (matches fabrary.net's Public tab search field / latest_search URL param)",
    )
    .option("-n, --limit <n>", "Max results", int, 20)
    .option("-p, --page <n>", "Page number (0-based)", int, 0)
    .action(
      async (
        opts: {
          hero?: string;
          format?: string;
          days?: number;
          hasMatchups?: boolean;
          hasResults?: boolean;
          tournamentOnly?: boolean;
          query?: string;
          latestSearch?: string;
          limit: number;
          page: number;
        },
        command: Command,
      ) => {
        const json = wantsJson(command);
        opts.query = opts.query ?? opts.latestSearch;
        const searchOpts = buildSearchOpts(opts);
        progressWrite(json, chalk.dim("Searching…\r"));
        const result = await searchDecks(searchOpts);
        progressWrite(json, "           \r");

        let decks = result.hits;
        if (opts.days) decks = filterByDays(decks, opts.days);

        if (json) {
          printJson({ decks, page: result.page, nbPages: result.nbPages });
          return;
        }

        printDecksTable(decks);
        if (result.nbPages > 1) {
          console.log(
            chalk.dim(
              `Page ${result.page + 1}/${result.nbPages} — use --page to navigate`,
            ),
          );
        }
      },
    );

  // ─── top ───────────────────────────────────────────────────────────────

  fabrary
    .command("top")
    .description(
      "Show top decks ranked by win rate (fetches results for each deck)",
    )
    .option("--hero <id>", "Hero identifier (e.g. prism-awakener-of-sol)")
    .option(
      "--format <format>",
      'Format (e.g. "Classic Constructed", CC, Blitz, SA)',
    )
    .option("--days <n>", "Only decks updated in the last N days", int)
    .option("--min-games <n>", "Minimum recorded games", int, 5)
    .option("--source <src>", "Filter by source (FaBrary, Talishar)")
    .option("--tournament-only", "Only tournament decks")
    .option("-n, --limit <n>", "Max decks to fetch", int, 40)
    .option("--show <n>", "Max rows in output", int, 20)
    .option("--per-hero", "Show best win-rate and most-games deck per hero")
    .option(
      "--top-n <n>",
      "Show top N decks per hero grouped together (implies --per-hero)",
      int,
    )
    .option(
      "--by-class",
      "Group --top-n output by class (fetches all hero class data)",
    )
    .option(
      "--class <name>",
      "Filter by hero class (e.g. Warrior, Ninja, Brute) — uses live card data",
    )
    .option(
      "--talent <name>",
      "Filter by hero talent (e.g. Shadow, Light, Ice) — uses live card data",
    )
    .option(
      "--young",
      "Include only young hero versions (default: adult only when --class/--talent used)",
    )
    .option(
      "--sort <order>",
      "Sort order: winrate (default) or games",
      "winrate",
    )
    .action(
      async (
        opts: {
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
        },
        command: Command,
      ) => {
        const json = wantsJson(command);
        const isGrouped = opts.perHero || opts.topN !== undefined;
        const fetchLimit = isGrouped ? Math.max(opts.limit, 200) : opts.limit;
        const searchOpts = buildSearchOpts({
          ...opts,
          hasResults: true,
          limit: fetchLimit,
        });

        // Resolve class/talent filter to a set of hero identifiers via live card search
        let heroFilter: Set<string> | null = null;
        if (opts.class || opts.talent) {
          progressWrite(json, chalk.dim("Looking up heroes…\r"));
          heroFilter = await callWithToken((t) =>
            getHeroIdentifiers(t, {
              class: opts.class,
              talent: opts.talent,
              young: opts.young,
            }),
          );
          if (heroFilter.size === 0) {
            if (json) {
              printJson({ decks: [] });
              return;
            }
            console.log(chalk.yellow("No heroes found for that class/talent."));
            return;
          }
        }

        progressWrite(json, chalk.dim("Fetching deck list…\r"));
        const result = await searchDecks(searchOpts);
        let decks = result.hits;
        if (opts.days) decks = filterByDays(decks, opts.days);
        if (heroFilter)
          decks = decks.filter((d) => heroFilter!.has(d.heroIdentifier));

        if (decks.length === 0) {
          if (json) {
            printJson({ decks: [] });
            return;
          }
          console.log(chalk.yellow("No decks found."));
          return;
        }

        progressWrite(
          json,
          chalk.dim(`Fetching results for ${decks.length} decks…\r`),
        );

        let done = 0;
        const tasks = decks.map((deck) => async () => {
          const r = await callWithToken((t) => getDeckResults(t, deck.deckId));
          done++;
          progressWrite(
            json,
            chalk.dim(`Fetching results… ${done}/${decks.length}\r`),
          );
          return { deck, results: r.results };
        });

        const fetched = await pLimit(tasks, 8);
        progressWrite(json, "                                        \r");

        const withStats: DeckWithStats[] = fetched
          .map(({ deck, results }) => {
            const filtered = opts.source
              ? results.filter(
                  (r) =>
                    (r.source ?? "").toLowerCase() ===
                    opts.source!.toLowerCase(),
                )
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
              const sorted = group
                .slice()
                .sort((a, b) =>
                  byGames ? b.total - a.total : b.winRate - a.winRate,
                )
                .slice(0, opts.topN);
              heroGroups.push({
                hero: group[0].hero,
                heroIdentifier: group[0].heroIdentifier,
                decks: sorted,
              });
            }
            heroGroups.sort((a, b) =>
              byGames
                ? (b.decks[0]?.total ?? 0) - (a.decks[0]?.total ?? 0)
                : (b.decks[0]?.winRate ?? 0) - (a.decks[0]?.winRate ?? 0),
            );

            if (opts.byClass) {
              // Fetch hero→classes map and group heroGroups by class
              progressWrite(json, chalk.dim("Fetching hero class data…\r"));
              const heroClassMap = await callWithToken((t) =>
                getHeroClassMap(t),
              );
              progressWrite(json, "                          \r");

              const classMap = new Map<string, HeroGroup[]>();
              for (const hg of heroGroups) {
                const classes = heroClassMap.get(hg.heroIdentifier) ?? [
                  "Unknown",
                ];
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

              if (json) {
                printJson({ classGroups });
                return;
              }
              printClassGroupedTable(classGroups, opts.topN);
            } else {
              if (json) {
                printJson({ heroGroups });
                return;
              }
              printGroupedTopTable(heroGroups);
            }
          } else {
            // --per-hero: one summary row per hero (best win rate + most games)
            const rows: HeroTopEntry[] = [];
            for (const [, group] of byHero) {
              const topWinRate =
                group.slice().sort((a, b) => b.winRate - a.winRate)[0] ?? null;
              const topGames =
                group.slice().sort((a, b) => b.total - a.total)[0] ?? null;
              rows.push({ hero: group[0].hero, topWinRate, topGames });
            }
            rows.sort(
              (a, b) =>
                (b.topWinRate?.winRate ?? 0) - (a.topWinRate?.winRate ?? 0),
            );
            if (json) {
              printJson({ perHero: rows });
              return;
            }
            printPerHeroTable(rows);
          }
        } else {
          const sorted = withStats
            .sort((a, b) =>
              opts.sort === "games" ? b.total - a.total : b.winRate - a.winRate,
            )
            .slice(0, opts.show);
          if (json) {
            printJson({ decks: sorted });
            return;
          }
          printTopTable(sorted);
        }
      },
    );

  // ─── deck ──────────────────────────────────────────────────────────────

  fabrary
    .command("deck <id>")
    .description(
      "Show deck detail with win rate, card list, matchup guides, and stats",
    )
    .option("--source <src>", "Filter results by source (FaBrary, Talishar)")
    .option(
      "--matchup <name>",
      "Show cards for a specific matchup only (partial name match)",
    )
    .option("--decklist-only", "Show only the decklist")
    .option("--matchups-only", "Show only per-matchup card lists")
    .option("--stats-only", "Show only stats")
    .action(
      async (
        id: string,
        opts: {
          source?: string;
          matchup?: string;
          decklistOnly?: boolean;
          matchupsOnly?: boolean;
          statsOnly?: boolean;
        },
        command: Command,
      ) => {
        const json = wantsJson(command);
        progressWrite(json, chalk.dim("Fetching deck…\r"));

        const [deck, resultsData, versionInfo] = await Promise.all([
          getDeckById(id),
          callWithToken((t) => getDeckResults(t, id)),
          callWithToken((t) => getDeckVersionInfo(t, id)),
        ]);
        const { typeMap } = versionInfo;
        progressWrite(json, "               \r");

        if (!deck) {
          console.error(chalk.red(`Deck ${id} not found.`));
          process.exit(1);
        }

        const filteredResults = opts.source
          ? resultsData.results.filter(
              (r) =>
                (r.source ?? "").toLowerCase() === opts.source!.toLowerCase(),
            )
          : resultsData.results;

        const winRateStats = computeWinRate(filteredResults);
        const resultStats = computeResultStats(filteredResults);
        const deckStats = computeDeckStats(versionInfo.cards);

        const showAll =
          !opts.decklistOnly && !opts.matchupsOnly && !opts.statsOnly;

        // Single-matchup view
        if (opts.matchup) {
          const needle = opts.matchup.toLowerCase();
          const matchup = versionInfo.matchups.find((m) =>
            m.name.toLowerCase().includes(needle),
          );
          if (!matchup) {
            console.error(
              chalk.red(`No matchup found matching "${opts.matchup}".`),
            );
            console.log(
              chalk.dim(
                "Available: " +
                  versionInfo.matchups.map((m) => m.name).join(", "),
              ),
            );
            process.exit(1);
          }
          const matchupCards = cardsForMatchup(
            versionInfo.cards,
            matchup.matchupId,
          );
          if (json) {
            printJson({ deck, matchup, cards: matchupCards });
            return;
          }
          printDeckDetail(
            deck,
            winRateStats.total > 0 ? winRateStats : undefined,
            [matchup],
            matchupCards,
            versionInfo.inventoryCards,
            typeMap,
          );
          return;
        }

        if (json) {
          const out: Record<string, unknown> = {};
          if (showAll || opts.decklistOnly) {
            out.decklist = {
              deck,
              winRateStats: winRateStats.total > 0 ? winRateStats : null,
              matchupNames: versionInfo.matchups.map((m) => m.name),
              cards: versionInfo.cards,
              inventoryCards: versionInfo.inventoryCards,
            };
          }
          if (showAll || opts.matchupsOnly) {
            out.matchups = versionInfo.matchups.map((m) => ({
              matchup: m,
              cards: cardsForMatchup(versionInfo.cards, m.matchupId),
            }));
          }
          if (showAll || opts.statsOnly) {
            out.stats = { deckName: deck.name, deckStats, resultStats };
          }
          printJson(out);
          return;
        }

        if (showAll || opts.decklistOnly) {
          printDeckDetail(
            deck,
            winRateStats.total > 0 ? winRateStats : undefined,
            versionInfo.matchups,
            versionInfo.cards,
            versionInfo.inventoryCards,
            typeMap,
          );
        }
        if ((showAll || opts.matchupsOnly) && versionInfo.matchups.length > 0) {
          printMatchupCards(
            versionInfo.matchups,
            versionInfo.cards,
            versionInfo.inventoryCards,
          );
        }
        if (showAll || opts.statsOnly) {
          printDeckStats(deck.name, deckStats, resultStats);
        }
      },
    );

  // ─── cards ─────────────────────────────────────────────────────────────

  registerCards(fabrary);

  // ─── meta ──────────────────────────────────────────────────────────────

  fabrary
    .command("meta")
    .description("Show hero win rates from the fabrary.net meta results matrix")
    .option("--format <fmt>", "Format (cc, sa, blitz, ll, upf)", "cc")
    .option(
      "--period <period>",
      "Period: 7d, 30d, 2026-04, or a season slug",
      "30d",
    )
    .option("--hero <id>", "Show matchup breakdown for a specific hero")
    .option("--show <n>", "Max heroes in output", int, 30)
    .option("--list-periods", "List all valid period slugs and exit")
    .action(
      async (
        opts: {
          format: string;
          period: string;
          hero?: string;
          show: number;
          listPeriods?: boolean;
        },
        command: Command,
      ) => {
        const json = wantsJson(command);
        if (opts.listPeriods) {
          progressWrite(json, chalk.dim("Loading periods…\r"));
          const groups = await fetchMetaPeriods();
          progressWrite(json, "                  \r");
          if (json) {
            printJson({ periods: groups });
            return;
          }
          printMetaPeriods(groups);
          return;
        }

        const formatSlug = resolveMetaFormat(opts.format);
        const period = resolveMetaPeriod(opts.period);
        progressWrite(
          json,
          chalk.dim(`Fetching meta (${formatSlug}, ${period})…\r`),
        );
        const rows = await fetchMetaResults(opts.format, opts.period);
        progressWrite(json, "                                          \r");

        if (opts.hero) {
          const needle = opts.hero.toLowerCase();
          const match = rows.find((r) => r.hero.toLowerCase().includes(needle));
          if (!match) {
            if (json) {
              printJson({ hero: null });
              return;
            }
            console.log(chalk.yellow(`No hero found matching "${opts.hero}".`));
            console.log(
              chalk.dim("Available: " + rows.map((r) => r.hero).join(", ")),
            );
            return;
          }
          if (json) {
            printJson({ hero: match });
            return;
          }
          printHeroMatchups(match);
        } else {
          if (json) {
            const sorted = rows
              .filter((r) => r.totalGames > 0)
              .sort((a, b) => b.overallWinRate - a.overallWinRate)
              .slice(0, opts.show);
            printJson({ heroes: sorted });
            return;
          }
          printMetaTable(rows, opts.show);
        }
      },
    );

  fabrary
    .command("meta-shift")
    .description("Compare 7d vs 30d win rates to identify trending heroes")
    .option("--format <fmt>", "Format (cc, sa, blitz, ll, upf)", "cc")
    .option(
      "--ban <ids>",
      "Comma-separated hero identifiers to treat as banned/removed",
    )
    .option(
      "--nerf <ids>",
      "Comma-separated hero identifiers with minor nerfs (~-6% WR)",
    )
    .option(
      "--exclude <ids>",
      "Comma-separated hero identifiers to hide from output",
    )
    .option(
      "--my-classes <classes>",
      "Comma-separated classes to filter heroes (e.g. guardian,warrior)",
    )
    .option("--show <n>", "Max heroes in output", int, 20)
    .action(
      async (opts: {
        format: string;
        ban?: string;
        nerf?: string;
        exclude?: string;
        myClasses?: string;
        show: number;
      }) => {
        const ban = opts.ban ? opts.ban.split(",").map((s) => s.trim()) : [];
        const nerf = opts.nerf ? opts.nerf.split(",").map((s) => s.trim()) : [];
        const exclude = opts.exclude
          ? opts.exclude.split(",").map((s) => s.trim())
          : [];
        const myClasses = opts.myClasses
          ? opts.myClasses.split(",").map((s) => s.trim().toLowerCase())
          : [];

        process.stdout.write(chalk.dim("Fetching 7d and 30d meta data…\r"));
        let rows = await computeMetaShift({
          format: opts.format,
          ban,
          nerf,
          exclude,
        });
        process.stdout.write("                                \r");

        // Filter to user's classes via live card data if requested
        if (myClasses.length > 0) {
          process.stdout.write(chalk.dim("Looking up hero classes…\r"));
          const heroFilter = await callWithToken((t) =>
            getHeroIdentifiers(t, {}),
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
      },
    );

  return fabrary;
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

/** Card list for one matchup — quantity falls back to the base deck quantity
 *  when the matchup has no override for that card. */
function cardsForMatchup(
  cards: DeckCard[],
  matchupId: string,
): { cardIdentifier: string; quantity: number }[] {
  return cards
    .map((c) => {
      const override = c.matchupQuantities?.find(
        (mq) => mq.matchupId === matchupId,
      );
      const qty = override !== undefined ? override.quantity : c.quantity;
      return { cardIdentifier: c.cardIdentifier, quantity: qty };
    })
    .filter((c) => c.quantity > 0);
}
