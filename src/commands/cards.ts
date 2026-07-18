import { Command } from "commander";
import chalk from "chalk";
import { searchCards } from "../graphql";
import { printCardsTable, printCardDetail } from "../display";
import { int, callWithToken, wantsJson, printJson } from "./util";

export function registerCards(fabrary: Command): Command {
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
        "  fab-cli fabrary cards local --keyword spectra --limit 50",
    )
    .option("--name", "match card names only")
    .option("--text", "match functional text only")
    .option("--keyword", "match card/granted keywords only")
    .option("--exact <name>", "exact (case-insensitive) name match")
    .option("--pitch <n>", "filter by pitch value")
    .option("--cost <n>", "filter by cost")
    .option(
      "--type <type>",
      "filter by type/subtype/class (exact word, e.g. Aura, Ninja, Instant)",
    )
    .option("--full", "print full JSON record(s)")
    .option("--limit <n>", "max results to show", "20")
    .action((terms: string[] = [], opts) => {
      const { searchLocalCards, CARD_DB_PATH } =
        require("../carddb") as typeof import("../carddb");
      if (terms.length === 0 && !opts.exact) {
        console.error(chalk.red("Provide search terms or --exact <name>."));
        process.exitCode = 1;
        return;
      }
      let results;
      try {
        results = searchLocalCards(terms, {
          scope: opts.name
            ? "name"
            : opts.text
              ? "text"
              : opts.keyword
                ? "keyword"
                : "any",
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
            "NO MATCH — try fewer/partial terms or --text; fall back to `fab-cli fabrary cards search` (live) or cardvault.fabtcg.com",
          ),
        );
        process.exitCode = 1;
        return;
      }
      const limit = parseInt(opts.limit, 10) || 20;
      console.log(
        chalk.dim(
          `${results.length} match(es) in ${CARD_DB_PATH}${results.length > limit ? ` (showing ${limit})` : ""}`,
        ),
      );
      for (const c of results.slice(0, limit)) {
        if (opts.full) {
          console.log(JSON.stringify(c, null, 2));
          continue;
        }
        const stats = (
          [
            "pitch",
            "cost",
            "power",
            "defense",
            "intelligence",
            "health",
          ] as const
        )
          .filter(
            (k) => c[k] !== undefined && c[k] !== null && String(c[k]) !== "",
          )
          .map((k) => `${k} ${c[k]}`)
          .join(" · ");
        console.log(
          `\n${chalk.bold(c.name)}  ${chalk.cyan(`[${c.types.join(" ")}]`)}${stats ? chalk.dim("  " + stats) : ""}`,
        );
        const txt = (c.functional_text ?? "").replace(/\n+/g, " ").trim();
        if (txt)
          console.log(`  ${txt.length > 300 ? txt.slice(0, 300) + "…" : txt}`);
      }
    });

  cardsCmd
    .command("search <text...>")
    .description(
      "Search cards by text. Supports inline filters: r:Rarity, t:Type, k:Keyword\n" +
        "  Examples:\n" +
        "    fab-cli fabrary cards search prism awakener\n" +
        "    fab-cli fabrary cards search r:Majestic prism\n" +
        "    fab-cli fabrary cards search vynnset t:Hero\n" +
        "    fab-cli fabrary cards search vynnset --foiling Cold --set Promos",
    )
    .option("-d, --detail", "Show full detail for each card")
    .option("-n, --limit <n>", "Max results to show", int)
    .option("--foiling <foiling>", "Filter by foiling: Cold, Gold, Rainbow")
    .option(
      "--treatment <treatment>",
      "Filter by art treatment: 'Alternate Art', 'Full Art', etc.",
    )
    .option("--artist <artist>", "Filter by artist name (partial match)")
    .option("--set <set>", "Filter by set name (partial match)")
    .option("--spec <hero>", "Filter by specialization hero (e.g. Vynnset)")
    .option("--subtype <subtype>", "Filter by subtype (e.g. Attack, Young, 1H)")
    .option("--class <class>", "Filter by class (e.g. Runeblade, Ninja)")
    .option("--talent <talent>", "Filter by talent (e.g. Shadow, Light, Ice)")
    .option("--fusion <element>", "Filter by fusion (Earth, Ice, Lightning)")
    .option("--legal <format>", "Filter cards legal in format (e.g. CC, Blitz)")
    .option(
      "--pitch <n>",
      "Filter by pitch value (1=red, 2=yellow, 3=blue)",
      int,
    )
    .option("--cost <n>", "Filter by cost value", int)
    .option("--defense <n>", "Filter by defense value", int)
    .option("--power <n>", "Filter by power value", int)
    .action(
      async (
        words: string[],
        opts: {
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
        },
        command: Command,
      ) => {
        const filters: string[] = [];
        if (opts.foiling) filters.push(`foiling:${opts.foiling}`);
        if (opts.treatment) filters.push(`treatment:${opts.treatment}`);
        if (opts.artist) filters.push(`artist:${opts.artist}`);
        if (opts.set) filters.push(`set:${opts.set}`);
        if (opts.spec) filters.push(`spec:${opts.spec}`);
        if (opts.subtype) filters.push(`subtype:${opts.subtype}`);
        if (opts.class) filters.push(`class:${opts.class}`);
        if (opts.talent) filters.push(`talent:${opts.talent}`);
        if (opts.fusion) filters.push(`fusion:${opts.fusion}`);
        if (opts.legal) filters.push(`legal:${opts.legal}`);
        if (opts.pitch !== undefined) filters.push(`pitch:${opts.pitch}`);
        if (opts.cost !== undefined) filters.push(`cost:${opts.cost}`);
        if (opts.defense !== undefined) filters.push(`defense:${opts.defense}`);
        if (opts.power !== undefined) filters.push(`power:${opts.power}`);

        const text = [...words, ...filters].join(" ");
        const json = wantsJson(command);
        if (!json) process.stdout.write(chalk.dim("Searching cards…\r"));
        const cards = await callWithToken((t) => searchCards(t, text));
        if (!json) process.stdout.write("                  \r");

        const display = opts.limit ? cards.slice(0, opts.limit) : cards;
        if (json) {
          printJson({ cards: display });
          return;
        }
        if (opts.detail) {
          for (const c of display) printCardDetail(c);
        } else {
          printCardsTable(display);
        }
      },
    );

  cardsCmd
    .command("show <text...>")
    .description("Show full detail for a specific card (first match)")
    .action(async (words: string[], _opts: unknown, command: Command) => {
      const text = words.join(" ");
      const json = wantsJson(command);
      if (!json) process.stdout.write(chalk.dim("Searching…\r"));
      const cards = await callWithToken((t) => searchCards(t, text));
      if (!json) process.stdout.write("           \r");
      if (cards.length === 0) {
        if (json) {
          printJson({ card: null });
          return;
        }
        console.log(chalk.yellow("No cards found."));
        return;
      }
      if (json) {
        printJson({ card: cards[0] });
        return;
      }
      printCardDetail(cards[0]);
      if (cards.length > 1) {
        console.log(
          chalk.dim(
            `+${cards.length - 1} more results. Run 'fab-cli fabrary cards search "${text}"' to see all.`,
          ),
        );
      }
    });

  return cardsCmd;
}
