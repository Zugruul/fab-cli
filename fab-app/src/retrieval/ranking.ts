import type { ActivatedChunk, ChunkCorpus, RankedChunk, RetrievalConfig } from "./types";
import { estimateTokens } from "./tokenBudget";

/**
 * Activation-ranked selection within the token budget (§9.7/§14): sort by
 * activation desc (ties broken by chunk id for determinism), then greedily
 * walk the ranked list filling the budget.
 *
 * Budget-clipping decision: a chunk that does NOT fit in the remaining
 * budget is SKIPPED, never truncated — shipping a partially-truncated
 * chunk as grounding context risks a citation pointing at broken or
 * misleading text, which Invariant 1 doesn't allow. The walk continues
 * past a skipped chunk rather than stopping there, so a later, smaller,
 * lower-ranked chunk can still fill the remaining budget — this maximizes
 * token-budget utilization (greedy best-effort bin-packing by rank) rather
 * than stopping at the first miss.
 */
export function rankAndClipToBudget(
  activation: Map<string, ActivatedChunk>,
  corpus: ChunkCorpus,
  config: RetrievalConfig,
): RankedChunk[] {
  const ranked = [...activation.values()].sort(
    (a, b) => b.activation - a.activation || a.chunkId.localeCompare(b.chunkId),
  );

  const budgetChars = config.tokenBudget * config.charsPerToken;
  const out: RankedChunk[] = [];
  let usedChars = 0;

  for (const entry of ranked) {
    const chunk = corpus.getById(entry.chunkId);
    if (!chunk) continue;

    const chunkChars = chunk.text.length;
    if (usedChars + chunkChars > budgetChars) continue;

    usedChars += chunkChars;
    out.push({
      chunk,
      activation: entry.activation,
      stage: entry.stage,
      estimatedTokens: estimateTokens(chunk.text, config.charsPerToken),
    });
  }

  return out;
}
