import { execFileSync } from "child_process";
import * as path from "path";
import { Command } from "commander";
import { registerFabrary } from "../../src/commands/fabrary";
import { registerFabtcg } from "../../src/commands/fabtcg";
import { registerRules } from "../../src/commands/rules";
import { registerLore } from "../../src/commands/lore";
import { registerPriceComparison } from "../../src/commands/priceComparison";

const BIN = path.join(__dirname, "..", "..", "bin", "fab.js");

/**
 * Every command/subcommand path in the live Commander tree, discovered by
 * building the same `program` cli.ts builds (via the real register*
 * functions) and walking `.commands` recursively. Deriving this from the
 * actual object model — rather than hand-authoring the list or parsing it
 * out of --help text — means a command added to or removed from
 * src/commands/* without a matching fixture update makes this test fail
 * for the right reason (missing/extra path), instead of silently passing.
 *
 * (Text-parsing --help output to discover subcommands was tried and
 * discarded: several commands, e.g. `fabrary cards local`, have multi-line
 * .description() text that renders with the same 2-space indent as real
 * Commands: entries, making the list ambiguous to parse.)
 */
export function discoverCommandPaths(): string[][] {
  const program = new Command();
  program
    .name("fab-cli")
    .description(
      "FaBrary CLI — search Flesh & Blood decks, cards, and tournament events",
    )
    .version("1.0.0");

  registerFabrary(program);
  registerFabtcg(program);
  registerRules(program);
  registerLore(program);
  registerPriceComparison(program);

  const paths: string[][] = [];

  function walk(cmd: Command, prefix: string[]): void {
    paths.push(prefix);
    for (const sub of cmd.commands) {
      if (sub.name() === "help") continue; // Commander's auto-added help command
      walk(sub, [...prefix, sub.name()]);
    }
  }

  walk(program, []);
  return paths;
}

function runHelp(args: string[]): string {
  return execFileSync(process.execPath, [BIN, ...args, "--help"], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

export interface HelpNode {
  path: string[];
  output: string;
}

/** Spawns bin/fab.js --help for every command path in the live Commander tree. */
export function collectHelpTree(): HelpNode[] {
  return discoverCommandPaths().map((cmdPath) => ({
    path: cmdPath,
    output: runHelp(cmdPath),
  }));
}
