import type { Chunk, ChunkGenerationOutcome } from "./types.js";

const ANSWER_TRUNCATE_CHARS = 400;

function escapeForTable(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Renders a per-run human-review file (SPEC-APP.md §7.3 / task AC: "sample
 * output human-reviewable ... markdown table of chunk → generated pairs").
 * One row per generated pair; chunks that failed to produce any pairs are
 * called out separately (with their reason) rather than silently omitted,
 * so a reviewer sees the whole picture, not just the successes.
 */
export function buildReviewMarkdown(
  outcomes: ChunkGenerationOutcome[],
  chunksById: Map<string, Chunk>,
): string {
  const acceptedCount = outcomes.reduce((sum, o) => sum + o.pairs.length, 0);
  const rejectedCount = outcomes.reduce((sum, o) => sum + o.rejected.length, 0);
  const failed = outcomes.filter((o) => o.status === "failed");

  const lines: string[] = [];
  lines.push("# Teacher Q&A review");
  lines.push("");
  lines.push(
    `Chunks processed: ${outcomes.length} · pairs accepted: ${acceptedCount} · pairs rejected: ${rejectedCount} · chunks failed: ${failed.length}`,
  );
  lines.push("");
  lines.push("| Chunk | Question | Answer |");
  lines.push("| --- | --- | --- |");

  for (const outcome of outcomes) {
    if (outcome.pairs.length === 0) continue;
    const title = chunksById.get(outcome.chunk_id)?.title ?? outcome.chunk_id;
    for (const pair of outcome.pairs) {
      lines.push(
        `| ${escapeForTable(title)} (${escapeForTable(outcome.chunk_id)}) | ${escapeForTable(pair.question)} | ${escapeForTable(truncate(pair.answer, ANSWER_TRUNCATE_CHARS))} |`,
      );
    }
  }

  if (failed.length > 0) {
    lines.push("");
    lines.push("## Failed chunks");
    lines.push("");
    for (const outcome of failed) {
      lines.push(`- **${outcome.chunk_id}** — failed: ${outcome.failureReason ?? "unknown reason"}`);
    }
  }

  return lines.join("\n") + "\n";
}
