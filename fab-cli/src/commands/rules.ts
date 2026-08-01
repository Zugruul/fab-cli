import { Command } from "commander";
import chalk from "chalk";
import { updateRulesDocs, commitRulesDocs, RULES_DIR } from "../rulesDocs";
import {
  syncRules,
  searchRules,
  resolveRulesRef,
  askRules,
  KB_RULES_DIR,
  ASK_RULES_ESCALATION_FOOTER,
  type RulesChunk,
} from "../rules";
import { int } from "./util";

const STOP = new Set(
  "the a an and or of to in is are was were be on for with at by from as into".split(
    " ",
  ),
);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9']+/g) || []).filter(
    (t) => t.length > 1 && !STOP.has(t),
  );
}

function makeSnippet(text: string, terms: string[], radius = 160): string {
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, pos - radius);
  const end = Math.min(text.length, pos + radius);
  return (
    (start > 0 ? "…" : "") +
    text.slice(start, end).replace(/\s+/g, " ").trim() +
    (end < text.length ? "…" : "")
  );
}

/** Shared result-list formatting, reused by both `rules search` and
 *  `rules ask` (document/section/source_url/snippet — the citation format
 *  every command that shows KB passages must match). */
function printRulesResults(hits: RulesChunk[], query: string): void {
  console.log(chalk.dim(`\n  ${hits.length} result(s) for "${query}"\n`));
  const terms = tokenize(query);
  for (const c of hits) {
    console.log(
      `  ${chalk.bold(c.title)}  ${chalk.dim(`[${c.document} ${c.section}]`)}`,
    );
    console.log(`  ${chalk.cyan(c.sourceUrl)}`);
    console.log(`  ${chalk.dim(makeSnippet(c.text, terms))}\n`);
  }
}

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

  rules
    .command("search <query...>")
    .description(
      "Search the rules KB (CR/TRP/PPG/CPG/legality); auto-refreshes stale sources, always re-fetches legality live when it's among the results",
    )
    .option("-n, --limit <n>", "Max results", int, 8)
    .action(async (parts: string[], opts: { limit: number }) => {
      const query = parts.join(" ");
      const hits = await searchRules(query, { limit: opts.limit });
      if (!hits.length) {
        console.log(chalk.yellow(`No rules found for "${query}".`));
        return;
      }
      printRulesResults(hits, query);
    });

  rules
    .command("ask <question...>")
    .description(
      "Retrieve + cite the most relevant rules passages for a question, always followed by the judge Discord #ask-a-judge escalation — this command retrieves and cites, it never generates an answer",
    )
    .option("-n, --limit <n>", "Max passages", int, 8)
    .action(async (parts: string[], opts: { limit: number }) => {
      const question = parts.join(" ");
      const { passages, confident } = await askRules(question, {
        limit: opts.limit,
      });
      if (passages.length) {
        printRulesResults(passages, question);
      } else {
        console.log(chalk.yellow(`No rules passages found for "${question}".`));
      }
      if (!confident) {
        console.log(chalk.yellow("  passages don't clearly settle this —"));
      }
      console.log(`  ${chalk.cyan(ASK_RULES_ESCALATION_FOOTER)}`);
    });

  rules
    .command("show <ref>")
    .description(
      "Print a rules chunk by ref (<document>/<section>, e.g. cr/1.1, or a section slug) + its source",
    )
    .action(async (ref: string) => {
      const { chunk, candidates } = await resolveRulesRef(ref);
      if (!chunk) {
        if (candidates.length > 1) {
          console.log(chalk.yellow(`Ambiguous ref "${ref}" — candidates:`));
          for (const c of candidates as RulesChunk[]) {
            console.log(
              `  ${chalk.bold(`${c.document}/${c.section}`)}  ${c.title}`,
            );
          }
        } else {
          console.log(chalk.yellow(`No rules chunk matching "${ref}".`));
        }
        process.exitCode = 1;
        return;
      }
      console.log(
        chalk.bold(`\n  [${chunk.document} ${chunk.section}] ${chunk.title}`),
      );
      console.log(`  ${chalk.cyan(chunk.sourceUrl)}\n`);
      console.log(chunk.text);
    });

  return rules;
}
