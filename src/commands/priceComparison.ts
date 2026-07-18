import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import {
  fetchGroups,
  fetchGroupProducts,
  fetchGroupPrices,
  fetchGroupData,
} from "../pricing/tcgcsv";
import {
  fetchProductConditions,
  fetchSetConditionListings,
} from "../pricing/tcgplayerSearch";
import { fetchCardmarketData } from "../pricing/cardmarket";
import { fetchEurUsdRate } from "../pricing/fx";
import {
  assembleCardComparison,
  printCardComparison,
  renderCsv,
  type CardCommandDeps,
} from "../pricing/cardCommand";
import { runExport, type ExportCommandDeps } from "../pricing/exportCommand";
import type { ExpansionAnchorMap } from "../pricing/expansionAnchoring";
import expansionAnchorMapJson from "../../data/cardmarket-expansions.json";

const cardmarketExpansionAnchorMap =
  expansionAnchorMapJson as unknown as ExpansionAnchorMap;

function buildCardCommandDeps(): CardCommandDeps {
  return {
    fetchGroups,
    fetchGroupProducts,
    fetchGroupPrices,
    fetchProductConditions: (q, opts) => fetchProductConditions(q, opts),
    fetchCardmarketData: (opts) => fetchCardmarketData(opts),
    fetchEurUsdRate: (opts) => fetchEurUsdRate(opts),
    expansionAnchorMap: cardmarketExpansionAnchorMap,
  };
}

function buildExportCommandDeps(): ExportCommandDeps {
  return {
    fetchGroups,
    fetchGroupData,
    fetchSetConditionListings: (setName, opts) =>
      fetchSetConditionListings(setName, opts),
    fetchCardmarketData: (opts) => fetchCardmarketData(opts),
    fetchEurUsdRate: (opts) => fetchEurUsdRate(opts),
    expansionAnchorMap: cardmarketExpansionAnchorMap,
  };
}

export function registerPriceComparison(program: Command): Command {
  const priceComparison = program
    .command("price-comparison")
    .description(
      "Compare Flesh & Blood single-card prices across TCGplayer and Cardmarket",
    );

  priceComparison
    .command("card <name>")
    .description(
      "Show per-condition prices for a card on every printing, plus cross-marketplace ratio tables",
    )
    .option(
      "--csv [file]",
      "Emit the §9.3 CSV layout instead of tables (stdout, or a file path if given)",
    )
    .option(
      "--refresh",
      "Bypass the tcgcsv/Cardmarket/FX disk caches and re-fetch",
    )
    .option(
      "--currency <usd|eur>",
      "Common currency ratio tables convert to",
      "usd",
    )
    .action(
      async (
        name: string,
        opts: { csv?: boolean | string; refresh?: boolean; currency?: string },
      ) => {
        const currency = opts.currency === "eur" ? "eur" : "usd";
        process.stdout.write(chalk.dim("Fetching price data…\r"));
        const result = await assembleCardComparison(
          name,
          buildCardCommandDeps(),
          {
            refresh: opts.refresh,
            currency,
          },
        );
        process.stdout.write("                        \r");

        if (result.kind === "none") {
          console.log(
            chalk.yellow(
              `No card matching "${name}" found in the TCGplayer catalog.`,
            ),
          );
          process.exitCode = 1;
          return;
        }
        if (result.kind === "ambiguous") {
          console.log(
            chalk.yellow(
              `"${name}" matches multiple cards — be more specific:`,
            ),
          );
          for (const candidate of result.candidates)
            console.log(`  ${candidate}`);
          process.exitCode = 1;
          return;
        }

        if (opts.csv) {
          const csv = renderCsv(result);
          if (typeof opts.csv === "string") {
            fs.writeFileSync(opts.csv, csv + "\n");
            console.log(chalk.dim(`Wrote ${opts.csv}`));
          } else {
            console.log(csv);
          }
        } else {
          printCardComparison(result);
        }

        if (result.ratioError) process.exitCode = 1;
      },
    );

  priceComparison
    .command("export")
    .description(
      "Export the full FAB singles catalog price comparison to CSV files (SPEC-PRICE §9.2)",
    )
    .option("--out <dir>", "Output directory", "./price-comparison/")
    .option(
      "--set <name...>",
      "Filter by tcgcsv group name (case-insensitive, repeatable). Default: full catalog",
    )
    .option(
      "--refresh",
      "Bypass the tcgcsv/Cardmarket/FX disk caches and re-fetch",
    )
    .option(
      "--currency <usd|eur>",
      "Common currency ratio pages convert to",
      "usd",
    )
    .action(
      async (opts: {
        out?: string;
        set?: string[];
        refresh?: boolean;
        currency?: string;
      }) => {
        const currency = opts.currency === "eur" ? "eur" : "usd";
        const outDir = opts.out ?? "./price-comparison/";

        let result;
        try {
          result = await runExport(buildExportCommandDeps(), {
            sets: opts.set,
            currency,
            refresh: opts.refresh,
            onSetProgress: ({ index, total, groupName, productCount }) => {
              console.log(
                chalk.dim(
                  `[${index}/${total}] ${groupName} — ${productCount} products`,
                ),
              );
            },
          });
        } catch (err) {
          console.error(chalk.red(`Export aborted: ${(err as Error).message}`));
          process.exitCode = 1;
          return;
        }

        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(
          path.join(outDir, "prices-tcgplayer.csv"),
          result.pricesTcgplayerCsv + "\n",
        );
        fs.writeFileSync(
          path.join(outDir, "prices-cardmarket.csv"),
          result.pricesCardmarketCsv + "\n",
        );
        fs.writeFileSync(
          path.join(outDir, "unmatched.csv"),
          result.unmatchedCsv + "\n",
        );
        if (!result.ratioError) {
          fs.writeFileSync(
            path.join(outDir, "ratio-tcgplayer-cardmarket.csv"),
            result.ratioTcgplayerCardmarketCsv + "\n",
          );
          fs.writeFileSync(
            path.join(outDir, "ratio-cardmarket-tcgplayer.csv"),
            result.ratioCardmarketTcgplayerCsv + "\n",
          );
        }

        console.log();
        console.log(
          chalk.bold(`Sets processed: ${result.summary.setsProcessed}`),
        );
        console.log(
          `Rows — tcgplayer: ${result.summary.rowsPerPage.tcgplayer}, cardmarket: ${result.summary.rowsPerPage.cardmarket}`,
        );
        console.log(
          `Match rate: ${(result.summary.matchRate * 100).toFixed(1)}%`,
        );
        if (result.summary.degradedSets.length > 0) {
          console.log(
            chalk.yellow(
              `Degraded sets (tcgplayer 403): ${result.summary.degradedSets.join(", ")}`,
            ),
          );
        }
        console.log(
          chalk.dim(
            `Elapsed: ${(result.summary.elapsedMs / 1000).toFixed(1)}s`,
          ),
        );
        console.log(chalk.dim(`Wrote output to ${outDir}`));

        if (result.ratioError) {
          console.log(chalk.red(result.ratioError));
          process.exitCode = 1;
        }
      },
    );

  return priceComparison;
}
