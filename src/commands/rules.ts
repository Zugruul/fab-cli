import { Command } from "commander";
import chalk from "chalk";
import { updateRulesDocs, commitRulesDocs, RULES_DIR } from "../rulesDocs";
import { syncRules, KB_RULES_DIR } from "../rules";

export function registerRules(program: Command): Command {
  const rules = program
    .command("rules")
    .description(
      "Official FAB rules documents (CR, TRP, PPG) vendored in third_party/fab-rules",
    );

  rules
    .command("update-docs")
    .description(
      "Redownload the vendored rules documents; replace only if validated (size + content sentinel), refresh VERSIONS.txt",
    )
    .option(
      "--commit",
      "Auto-commit third_party/fab-rules when a document actually changed",
    )
    .action(async (opts: { commit?: boolean }) => {
      console.log(chalk.dim(`Updating ${RULES_DIR} …`));
      const results = await updateRulesDocs();
      for (const r of results) {
        const color =
          r.status === "failed"
            ? chalk.red
            : r.status === "updated"
              ? chalk.green
              : chalk.dim;
        console.log(
          `  ${color(r.status.padEnd(9))} ${r.file}  ${chalk.dim(r.detail)}${r.lastModified ? chalk.dim(`  (last-modified: ${r.lastModified})`) : ""}`,
        );
      }
      if (results.some((r) => r.status === "failed")) process.exitCode = 1;
      if (opts.commit) {
        const hash = commitRulesDocs(results);
        console.log(
          hash
            ? chalk.green(`  committed ${hash}`)
            : chalk.dim("  nothing to commit"),
        );
      } else if (results.some((r) => r.status === "updated")) {
        console.log(
          chalk.yellow(
            "  documents changed — rerun with --commit to commit the update",
          ),
        );
      }
    });

  rules
    .command("sync")
    .description(
      "Sync the full rules KB (CR, TRP, PPG, CPG, Card Legality Policy) into kb/rules/ — chunked, cited, versioned",
    )
    .action(async () => {
      console.log(chalk.dim(`Syncing rules KB → ${KB_RULES_DIR} …`));
      const results = await syncRules();
      for (const r of results) {
        const color = r.status === "failed" ? chalk.red : chalk.green;
        console.log(
          `  ${color(r.status.padEnd(6))} ${r.document.padEnd(10)} ${r.chunks} chunk(s)${r.detail ? chalk.dim(`  ${r.detail}`) : ""}`,
        );
      }
      // Unlike update-docs' simpler `status === "failed"` check, a failed
      // source with chunks already on disk (stale-but-present from a prior
      // sync) is not treated as a hard failure here — last-known-good chunks
      // are preserved and still usable, so only exit non-zero when a source
      // has zero chunks to fall back on.
      if (results.some((r) => r.status === "failed" && r.chunks === 0)) {
        process.exitCode = 1;
      }
    });

  return rules;
}
