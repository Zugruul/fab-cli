import { execFileSync } from "child_process";
import * as path from "path";

const BIN = path.join(__dirname, "..", "..", "bin", "fab.js");

/**
 * Every command/subcommand path in the CLI, as registered in src/cli.ts (or,
 * post-split, src/commands/*.ts). Enumerated by hand from the Commander tree
 * rather than parsed out of --help text, because several commands (e.g.
 * `fabrary cards local`) have multi-line .description() text that renders
 * with the same 2-space indent as real Commands: entries, making textual
 * parsing of the list ambiguous.
 */
export const CLI_COMMAND_PATHS: string[][] = [
  [],
  ["fabrary"],
  ["fabrary", "auth"],
  ["fabrary", "login"],
  ["fabrary", "heroes"],
  ["fabrary", "formats"],
  ["fabrary", "search"],
  ["fabrary", "top"],
  ["fabrary", "deck"],
  ["fabrary", "cards"],
  ["fabrary", "cards", "local"],
  ["fabrary", "cards", "search"],
  ["fabrary", "cards", "show"],
  ["fabrary", "meta"],
  ["fabrary", "meta-shift"],
  ["fabtcg"],
  ["fabtcg", "events"],
  ["fabtcg", "card"],
  ["fabtcg", "coverage"],
  ["rules"],
  ["rules", "update-docs"],
  ["lore"],
  ["lore", "sync"],
  ["lore", "search"],
  ["lore", "show"],
  ["lore", "list"],
  ["price-comparison"],
  ["price-comparison", "card"],
  ["price-comparison", "export"],
];

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

/** Spawns bin/fab.js --help for every known command path in the CLI. */
export function collectHelpTree(): HelpNode[] {
  return CLI_COMMAND_PATHS.map((cmdPath) => ({
    path: cmdPath,
    output: runHelp(cmdPath),
  }));
}
