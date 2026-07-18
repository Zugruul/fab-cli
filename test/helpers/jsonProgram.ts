// Builds a Commander program the same way cli.ts does (global --json option +
// registerFabrary/registerFabtcg), for in-process --json flag tests. Mirrors
// cli.ts's wiring without the parseAsync/catch bootstrapping.
import { Command } from "commander";
import { registerFabrary } from "../../src/commands/fabrary";
import { registerFabtcg } from "../../src/commands/fabtcg";

export function buildJsonProgram(): Command {
  const program = new Command();
  program
    .name("fab-cli")
    .description("test")
    .version("1.0.0")
    .option("--json", "Emit machine-readable JSON to stdout");
  registerFabrary(program);
  registerFabtcg(program);
  return program;
}
