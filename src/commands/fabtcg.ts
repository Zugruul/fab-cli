import { Command } from "commander";
import chalk from "chalk";
import {
  fetchEvents,
  searchTournament,
  fetchCoverageIndex,
  fetchStandings,
  searchTournamentDecklists,
  fetchDecklistCards,
  fetchPlayerPath,
  searchPlayerInEvent,
  heroNameToIdentifier,
} from "../fabtcg";
import {
  searchCardVault,
  fetchCardVaultCard,
  renderTextbox,
} from "../cardvault";
import { findFabraryDeck } from "../algolia";
import {
  printEventsTable,
  printCoverageIndex,
  printStandings,
  printFieldMeta,
  printDecklistMetas,
  printPlayerDecklist,
  printPlayerPath,
} from "../display";

export function registerFabtcg(program: Command): Command {
  const fabtcg = program
    .command("fabtcg")
    .description("Official FAB TCG site data (events, organised play)");

  fabtcg
    .command("events")
    .description("Show upcoming organised play events from fabtcg.com")
    .option(
      "--world-tour",
      "Only Pro Tour, Calling, and World Championship events",
    )
    .option("--upcoming", "Only future events (after today)")
    .option("--format <fmt>", "Filter by format (partial match)")
    .option(
      "--with-coverage",
      "Only events that have a live coverage page with results/standings",
    )
    .option("--year <n>", "Fetch events from a specific year (e.g. 2025)")
    .action(
      async (opts: {
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
      },
    );

  fabtcg
    .command("card [query...]")
    .description(
      "Official Card Vault (cardvault.fabtcg.com): TRUE text (authoritative per CR 2.0.2), printed text, legality",
    )
    .option("--name <text>", "Card name contains")
    .option("--text <text>", "Rules text contains")
    .option("--pitch <n>", "Exact pitch value")
    .option("--cost <n>", "Exact cost value")
    .option("--power <n>", "Exact power value")
    .option("--defense <n>", "Exact defense value")
    .option("--talent <talent>", "Talent (e.g. Ice, Shadow)")
    .option("--class <class>", "Class (e.g. Illusionist, Bard)")
    .option("--subtype <subtype>", "Subtype (e.g. Aura, (2H))")
    .option("--format <fmt>", 'Legal in format (e.g. "Classic Constructed")')
    .option("--rarity <rarity>", "Rarity (e.g. common, majestic)")
    .option("--set <code>", "Set code (e.g. WTR, MON)")
    .option("--artist <name>", "Artist name")
    .option("-n, --limit <n>", "Max results to list", "10")
    .option("--list-only", "Only list matches; skip the true-text detail fetch")
    .option("--json", "Raw JSON of the detail record")
    .action(
      async (
        query: string[],
        opts: {
          name?: string;
          text?: string;
          pitch?: string;
          cost?: string;
          power?: string;
          defense?: string;
          talent?: string;
          class?: string;
          subtype?: string;
          format?: string;
          rarity?: string;
          set?: string;
          artist?: string;
          limit: string;
          listOnly?: boolean;
          json?: boolean;
        },
      ) => {
        const q = query.join(" ").trim();
        if (
          !q &&
          !opts.name &&
          !opts.text &&
          !opts.set &&
          !opts.artist &&
          !opts.class &&
          !opts.talent
        ) {
          console.log(
            chalk.yellow(
              "Give a search query or at least one filter (--name, --text, --set, …)",
            ),
          );
          return;
        }
        process.stdout.write(chalk.dim("Searching Card Vault…\r"));
        const results = await searchCardVault({
          q: q || undefined,
          name: opts.name,
          text: opts.text,
          pitch: opts.pitch ? parseInt(opts.pitch) : undefined,
          cost: opts.cost ? parseInt(opts.cost) : undefined,
          power: opts.power ? parseInt(opts.power) : undefined,
          defense: opts.defense ? parseInt(opts.defense) : undefined,
          talents: opts.talent,
          classes: opts.class,
          subtype: opts.subtype,
          legalFormats: opts.format,
          rarities: opts.rarity,
          setCode: opts.set,
          artistName: opts.artist,
          pageSize: parseInt(opts.limit),
        });
        process.stdout.write("                        \r");
        if (results.length === 0) {
          console.log(chalk.yellow("No Card Vault matches."));
          return;
        }
        if (results.length > 1 || opts.listOnly) {
          for (const r of results) {
            const pitch = r.printed_pitch
              ? ` ${"●".repeat(parseInt(r.printed_pitch) || 0)}`
              : "";
            console.log(
              `${chalk.bold(r.printed_name)}${pitch} ${chalk.dim(`— ${r.printed_typebox} [${r.print_id}]`)}`,
            );
          }
          if (opts.listOnly) return;
          console.log();
        }

        const card = await fetchCardVaultCard(results[0].card_id);
        if (!card) {
          console.log(
            chalk.yellow(`No detail record for ${results[0].card_id}.`),
          );
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(card, null, 2));
          return;
        }
        for (const core of card.cores) {
          const display = core.name.includes("---")
            ? core.name.split("---")[1]
            : core.name;
          console.log(
            chalk.bold.cyan(display) + chalk.dim(`  (${card.card_id})`),
          );
          console.log(chalk.dim(core.typebox));
          const stats = [
            core.pitch_value && `pitch ${core.pitch_value}`,
            core.cost_value && `cost ${core.cost_value}`,
            core.power_value && `power ${core.power_value}`,
            core.defense_value && `defense ${core.defense_value}`,
            core.life_value && `life ${core.life_value}`,
            core.intellect_value && `intellect ${core.intellect_value}`,
          ]
            .filter(Boolean)
            .join(" · ");
          if (stats) console.log(chalk.dim(stats));
          console.log(
            chalk.green.bold("\nTRUE TEXT") +
              chalk.dim(" (authoritative, CR 2.0.2):"),
          );
          console.log(renderTextbox(core.textbox));
        }
        // Flag every distinct English printed wording that differs from the true text.
        // Reminder text (italic parentheticals) and bold markers aren't rules text — strip
        // them before comparing, so a print differing only in reminder text isn't flagged.
        const norm = (s: string) =>
          renderTextbox(s)
            .replace(/_\([^)]*\)_/g, "")
            .replace(/\*\*/g, "")
            .replace(/[.\s]+$/g, "")
            .replace(/\s+/g, " ")
            .trim();
        const trueFlat = norm(card.cores.map((c) => c.textbox).join("{br}"));
        const divergent = new Map<string, string[]>(); // printed text -> print ids
        for (const p of card.card_prints.filter(
          (p) => p.print_language === "en",
        )) {
          const printed = p.faces[0]?.printed_rules_text ?? "";
          if (printed && norm(printed) !== trueFlat) {
            const ids = divergent.get(printed) ?? [];
            ids.push(p.print_id);
            divergent.set(printed, ids);
          }
        }
        for (const [printed, ids] of divergent) {
          console.log(
            chalk.yellow.bold(`\nPRINTED TEXT DIFFERS (${ids.join(", ")}):`),
          );
          console.log(chalk.dim(renderTextbox(printed)));
        }
        if (card.rulings_errata.length > 0) {
          console.log(
            chalk.magenta.bold(
              `\nRulings/errata: ${card.rulings_errata.length} — see https://cardvault.fabtcg.com/card/${card.card_id}/`,
            ),
          );
        }
        console.log(chalk.bold("\nLegality:"));
        for (const [fmt, info] of Object.entries(card.card_legality)) {
          const mark =
            info.legality === "legal"
              ? chalk.green("legal")
              : chalk.red(info.legality);
          console.log(
            `  ${fmt.padEnd(20)} ${mark}${info.reason ? chalk.dim(` (${info.reason})`) : ""}`,
          );
        }
        console.log(
          chalk.dim(`\nhttps://cardvault.fabtcg.com/card/${card.card_id}/`),
        );
      },
    );

  /** Fetch a decklist by slug, cross-reference Fabrary, and print it. */
  async function fetchAndPrintDecklist(
    decklistSlug: string,
    knownFormat?: string | null,
  ): Promise<void> {
    const full = await fetchDecklistCards(decklistSlug);
    if (!full) {
      console.log(chalk.yellow("Could not fetch card data for decklist."));
      return;
    }

    // Attempt to find a matching deck on Fabrary
    const heroId = heroNameToIdentifier(full.hero);
    const format = full.format ?? knownFormat ?? "Classic Constructed";
    const fabraryMatch = await findFabraryDeck(
      full.player,
      heroId,
      format,
    ).catch(() => null);
    if (fabraryMatch) full.fabraryDeckId = fabraryMatch.deckId;

    printPlayerDecklist(full);
  }

  fabtcg
    .command("coverage <event>")
    .description(
      "Tournament coverage: standings, hero field, decklists, player path",
    )
    .option(
      "--round <n>",
      "Show standings for a specific round (number or 'final')",
    )
    .option(
      "--field",
      "Show hero field breakdown from latest available standings",
    )
    .option("--decklists", "List available decklists for the event")
    .option("--player <name>", "Show decklist for a specific player")
    .option(
      "--path <name>",
      "Reconstruct a player's full round-by-round journey",
    )
    .option("--search-player <name>", "Find a player by partial name match")
    .action(
      async (
        eventName: string,
        opts: {
          round?: string;
          field?: boolean;
          decklists?: boolean;
          player?: string;
          path?: string;
          searchPlayer?: string;
        },
      ) => {
        process.stdout.write(chalk.dim("Searching tournament…\r"));

        // Resolve slug: try exact slug first, else search via WP API
        let slug = eventName
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        try {
          // Try to fetch coverage index directly with the slug
          const idx = await fetchCoverageIndex(slug);
          process.stdout.write("                          \r");

          if (
            !opts.round &&
            !opts.field &&
            !opts.decklists &&
            !opts.player &&
            !opts.path &&
            !opts.searchPlayer
          ) {
            printCoverageIndex(idx);
            return;
          }

          if (opts.round) {
            const r = opts.round === "final" ? "final" : parseInt(opts.round);
            process.stdout.write(
              chalk.dim(`Fetching standings round ${opts.round}…\r`),
            );
            const rows = await fetchStandings(slug, r);
            process.stdout.write("                                    \r");
            printStandings(
              rows,
              `${idx.title} — Round ${opts.round} Standings`,
            );
          }

          if (opts.field) {
            // Use latest available standings round for field breakdown
            const latestRound =
              idx.standingRounds[idx.standingRounds.length - 1] ?? 1;
            process.stdout.write(
              chalk.dim(`Fetching field data (round ${latestRound})…\r`),
            );
            const rows = await fetchStandings(slug, latestRound);
            process.stdout.write(
              "                                          \r",
            );
            printFieldMeta(rows);
          }

          if (opts.decklists) {
            process.stdout.write(chalk.dim("Fetching decklists…\r"));
            const decklists = await searchTournamentDecklists(
              slug,
              opts.player,
            );
            process.stdout.write("                    \r");
            if (opts.player && decklists.length === 1) {
              await fetchAndPrintDecklist(
                decklists[0].slug,
                decklists[0].format,
              );
            } else {
              printDecklistMetas(decklists);
            }
          }

          if (opts.player && !opts.decklists) {
            process.stdout.write(
              chalk.dim(`Fetching decklist for ${opts.player}…\r`),
            );
            const decklists = await searchTournamentDecklists(
              slug,
              opts.player,
            );
            process.stdout.write("                                    \r");
            if (decklists.length === 0) {
              console.log(
                chalk.yellow(
                  `No decklists found for player "${opts.player}" at ${slug}`,
                ),
              );
            } else if (decklists.length === 1) {
              await fetchAndPrintDecklist(
                decklists[0].slug,
                decklists[0].format,
              );
            } else {
              console.log(
                chalk.dim(`Multiple decklists found for "${opts.player}":`),
              );
              printDecklistMetas(decklists);
            }
          }

          if (opts.searchPlayer) {
            process.stdout.write(
              chalk.dim(`Searching for "${opts.searchPlayer}"…\r`),
            );
            const matches = await searchPlayerInEvent(slug, opts.searchPlayer);
            process.stdout.write("                                    \r");
            if (matches.length === 0) {
              console.log(
                chalk.yellow(
                  `No players found matching "${opts.searchPlayer}" at ${slug}`,
                ),
              );
            } else if (matches.length === 1) {
              // Single match — auto-run path
              console.log(
                chalk.dim(
                  `Found: ${matches[0].name}${matches[0].hero ? ` (${matches[0].hero})` : ""} — loading path…\n`,
                ),
              );
              process.stdout.write(
                chalk.dim(`Building path for ${matches[0].name}…\r`),
              );
              const path = await fetchPlayerPath(slug, matches[0].name);
              process.stdout.write(
                "                                          \r",
              );
              if (path) printPlayerPath(path);
              else console.log(chalk.yellow("No pairings found."));
            } else {
              console.log(
                chalk.dim(
                  `\n  ${matches.length} players found matching "${opts.searchPlayer}":`,
                ),
              );
              matches.forEach((m) =>
                console.log(
                  `  ${chalk.bold(m.name)}${m.hero ? chalk.dim("  " + m.hero) : ""}`,
                ),
              );
              console.log(
                chalk.dim(
                  `\n  Re-run with --path "<name>" to see full journey.`,
                ),
              );
            }
          }

          if (opts.path) {
            process.stdout.write(
              chalk.dim(`Building path for ${opts.path}…\r`),
            );
            const path = await fetchPlayerPath(slug, opts.path);
            process.stdout.write(
              "                                          \r",
            );
            if (!path) {
              console.log(
                chalk.yellow(
                  `No pairings found for player "${opts.path}" at ${slug}`,
                ),
              );
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
            console.error(
              chalk.red(
                `Could not find tournament "${eventName}": ${(e2 as Error).message}`,
              ),
            );
            process.exit(1);
          }
          process.stdout.write("                     \r");

          if (tournaments.length === 0) {
            console.log(
              chalk.yellow(`No tournaments found matching "${eventName}"`),
            );
            return;
          }
          if (tournaments.length > 1) {
            console.log(chalk.dim("Multiple tournaments found:"));
            tournaments.forEach((t, i) =>
              console.log(`  ${i + 1}. ${t.title}  (${t.slug})`),
            );
            console.log(chalk.dim("Re-run with the exact slug, e.g.:"));
            console.log(
              chalk.cyan(`  fab-cli fabtcg coverage "${tournaments[0].slug}"`),
            );
            return;
          }
          // Exactly one match — recurse with slug
          slug = tournaments[0].slug;
          const idx = await fetchCoverageIndex(slug).catch(() => null);
          if (!idx) {
            console.log(
              chalk.yellow(
                `No coverage page found for "${tournaments[0].title}" (${slug})`,
              ),
            );
            return;
          }
          printCoverageIndex(idx);
        }
      },
    );

  return fabtcg;
}
