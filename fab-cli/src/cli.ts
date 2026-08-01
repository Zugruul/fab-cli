#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { registerFabrary } from "./commands/fabrary";
import { registerFabtcg } from "./commands/fabtcg";
import { registerRules } from "./commands/rules";
import { registerLore } from "./commands/lore";
import { registerPriceComparison } from "./commands/priceComparison";

const program = new Command();

program
  .name("fab-cli")
  .description("FaBrary CLI — search Flesh & Blood decks, cards, and tournament events")
  .version("1.0.0")
  .option(
    "--json",
    "Emit machine-readable JSON to stdout instead of formatted tables (no ANSI decoration). Supported on: fabrary search/top/deck, fabrary meta, fabrary cards search/show, fabtcg events/coverage.",
  );

registerFabrary(program);
registerFabtcg(program);
registerRules(program);
registerLore(program);
registerPriceComparison(program);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(chalk.red(`Error: ${err.message}`));
  process.exit(1);
});
