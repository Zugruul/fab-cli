import type { Chunk } from "../types.js";
import type { DatasetCategory } from "./types.js";

/** rules/<document>/<section> documents that are tournament/event
 * governance rather than card-interaction rules — Tournament Rules
 * Procedure, Player Procedure Guide, Casual Procedure Guide, and the live
 * Card Legality Policy (see sources/rules.ts's chunk_id scheme and
 * fab-cli's kb/rules document set). */
const PROCEDURE_DOCUMENTS = new Set(["trp", "ppg", "cpg", "legality"]);

/**
 * Maps a source chunk to one of SPEC-APP.md §7.8's seven eval-stratification
 * categories, using only `chunk_id` prefix + `tags` (no source-text
 * inspection) so categorization is cheap, deterministic, and stable across
 * re-exports of an unchanged note. This is a documented judgment call (the
 * task brief: "derive categories from chunk_id prefixes + tags + example
 * type; document the mapping") — there is no existing eval-category
 * taxonomy elsewhere in the repo to defer to, so the mapping below is this
 * task's own, spelled out here rather than left implicit:
 *
 *  - `lore/**` chunk_ids (see sources/lore.ts), or a `"lore"` tag ->
 *    "lore".
 *  - `rules/<document>/**` chunk_ids (see sources/rules.ts): trp/ppg/cpg
 *    (tournament and event procedure documents) AND legality (the live
 *    Card Legality Policy — itself a tournament-eligibility ruling) ->
 *    "tournament-procedure". cr, reprise (fabtcg.com's per-set
 *    "interaction-guidance" article series — see fab-cli/CLAUDE.md), and
 *    any other/future rules document -> "multi-card-interactions", the
 *    closest of the seven to "general card-interaction rules judgment".
 *    NOTE: this function still categorizes legality chunks (needed for
 *    distractor-example stratification); §7.9's exclusion of legality
 *    content from QA/DPO fact-training is a SEPARATE, later filter applied
 *    by assemble.ts, not something this pure category-mapping enforces.
 *  - `brain/**` chunk_ids (see sources/brains.ts), by the identity brains'
 *    established note-slug conventions (.claude/identities/<identity>/brain/notes
 *    — e.g. `kw-dominate.md`, `card-heartstoker-branchblade.md`,
 *    `ci-steal-is-gain-control.md`): a `kw-` slug (or a `"keyword"` tag) ->
 *    "keyword-definitions"; a `card-` slug (or a `"card"` tag) ->
 *    "card-facts"; a `ci-`/`ruling-`/`interaction-` slug (or an
 *    `"interaction"` tag) -> "multi-card-interactions". Any other brain
 *    note (general rulings/procedure notes with no slug/tag match, e.g.
 *    `combat-chain-steps.md`, `strategy-blocking-basics.md`) defaults to
 *    "multi-card-interactions" too — §7.8 has no generic eighth "general
 *    rules" bucket, and card-interaction judgment is the closest fit for
 *    an undifferentiated rules/strategy note.
 *  - Any chunk_id scheme this function doesn't recognize also defaults to
 *    "multi-card-interactions" — this function always returns a value,
 *    never throws, since every chunk must land in exactly one category for
 *    the eval split (split.ts) to be well-defined.
 */
export function categorizeChunk(chunk: Chunk): DatasetCategory {
  if (chunk.chunk_id.startsWith("lore/") || chunk.tags.includes("lore")) return "lore";

  if (chunk.chunk_id.startsWith("rules/")) {
    const document = chunk.chunk_id.split("/")[1] ?? "";
    return PROCEDURE_DOCUMENTS.has(document) ? "tournament-procedure" : "multi-card-interactions";
  }

  if (chunk.chunk_id.startsWith("brain/")) {
    const slug = chunk.chunk_id.split("/").pop() ?? "";
    if (slug.startsWith("kw-") || chunk.tags.includes("keyword")) return "keyword-definitions";
    if (slug.startsWith("card-") || chunk.tags.includes("card")) return "card-facts";
    return "multi-card-interactions";
  }

  return "multi-card-interactions";
}
