import { Command } from "commander";
import chalk from "chalk";
import {
  ensureIndex,
  buildIndex,
  loadIndex,
  search as searchLore,
  findDoc,
  readDocBody,
  updateSubmodule,
} from "../lore";
import { int } from "./util";

export function registerLore(program: Command): Command {
  const lore = program
    .command("lore")
    .description(
      "Flesh & Blood lore from legendarystories.net (fablore submodule)",
    );

  lore
    .command("sync")
    .description(
      "Update the fablore submodule and rebuild the lore index + OKF files",
    )
    .option(
      "--no-update",
      "Skip pulling upstream; just rebuild from the current submodule",
    )
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
      if (offline)
        console.log(
          chalk.yellow(
            `Could not pull upstream (${offline.split("\n")[0]}); used current submodule.`,
          ),
        );
      else if (opts.update)
        console.log(chalk.green("Submodule up to date with upstream."));
      console.log(
        `Indexed ${chalk.bold(String(index.count))} lore documents @ ${chalk.dim(index.commit.slice(0, 7))}`,
      );
      console.log(
        chalk.dim(
          `Index: lore/index.json${opts.okf ? "  ·  OKF: lore/**.md" : ""}`,
        ),
      );
    });

  lore
    .command("search <query...>")
    .description(
      "Search the lore; results link to their legendarystories.net source",
    )
    .option("-n, --limit <n>", "Max results", int, 8)
    .option("--no-sync", "Don't refresh the submodule (offline)")
    .option("--force-sync", "Refresh upstream now even if recently synced")
    .option(
      "--include-archive",
      "Also search archive/ (older, possibly non-canon lore)",
    )
    .action(
      (
        parts: string[],
        opts: {
          limit: number;
          sync: boolean;
          forceSync?: boolean;
          includeArchive?: boolean;
        },
      ) => {
        const query = parts.join(" ");
        // Default: throttled auto-refresh (pull only if older than the TTL). --no-sync skips; --force-sync forces.
        const updateMode: boolean | "auto" =
          opts.sync === false ? false : opts.forceSync ? true : "auto";
        if (updateMode) process.stdout.write(chalk.dim("Refreshing lore…\r"));
        const { index, offline } = ensureIndex({ update: updateMode });
        process.stdout.write("                    \r");
        if (offline)
          console.log(chalk.yellow("(offline — searching last synced lore)\n"));
        const hits = searchLore(index, query, {
          limit: opts.limit,
          includeArchive: opts.includeArchive,
        });
        if (!hits.length) {
          console.log(chalk.yellow(`No lore found for "${query}".`));
          return;
        }
        const archiveNote = opts.includeArchive
          ? chalk.yellow("  ·  including archive (may be non-canon)")
          : chalk.dim("  ·  archive excluded (use --include-archive)");
        console.log(
          chalk.dim(
            `\n  ${hits.length} result(s) for "${query}"  ·  source: legendarystories.net`,
          ) +
            archiveNote +
            "\n",
        );
        for (const h of hits) {
          console.log(
            `  ${chalk.bold(h.title)}  ${chalk.dim("[" + h.section + "]")}`,
          );
          console.log(`  ${chalk.cyan(h.sourceUrl)}`);
          console.log(`  ${chalk.dim(h.snippet)}\n`);
        }
      },
    );

  lore
    .command("show <key...>")
    .description(
      "Print a lore document (by path, slug, or title) + its source URL",
    )
    .action((parts: string[]) => {
      const index = loadIndex();
      if (!index) {
        console.log(chalk.yellow("No index yet — run: fab-cli lore sync"));
        return;
      }
      const doc = findDoc(index, parts.join(" "));
      if (!doc) {
        console.log(
          chalk.yellow(`No lore page matching "${parts.join(" ")}".`),
        );
        return;
      }
      console.log(chalk.bold(`\n  ${doc.title}`));
      console.log(`  ${chalk.cyan(doc.sourceUrl)}\n`);
      console.log(readDocBody(doc.path));
    });

  lore
    .command("list")
    .description("List lore documents")
    .option("-s, --section <name>", "Filter by section (e.g. heroes-of-rathe)")
    .option("-q, --filter <text>", "Filter by title substring")
    .option(
      "--include-archive",
      "Include archive/ (older, possibly non-canon lore)",
    )
    .action(
      (opts: {
        section?: string;
        filter?: string;
        includeArchive?: boolean;
      }) => {
        const index = loadIndex();
        if (!index) {
          console.log(chalk.yellow("No index yet — run: fab-cli lore sync"));
          return;
        }
        let docs = index.docs;
        if (!opts.includeArchive && opts.section !== "archive")
          docs = docs.filter((d) => d.section !== "archive");
        if (opts.section) docs = docs.filter((d) => d.section === opts.section);
        if (opts.filter)
          docs = docs.filter((d) =>
            d.title.toLowerCase().includes(opts.filter!.toLowerCase()),
          );
        for (const d of docs)
          console.log(`  ${chalk.bold(d.title)}  ${chalk.dim(d.path)}`);
        console.log(chalk.dim(`\n  ${docs.length} document(s)`));
      },
    );

  return lore;
}
