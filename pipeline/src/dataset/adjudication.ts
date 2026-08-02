/**
 * BUG-186: SPEC-APP.md §8.4's "adjudication-critical rules categories" eval
 * suite is a NARROWER, curated selection — not §7.8's whole
 * "multi-card-interactions" stratification category (which stays as-is for
 * split purposes; see categorize.ts). A wrong ruling is the product's worst
 * failure mode, so the gate's suite is built only from precisely-grounded
 * rules content:
 *
 *  - Comprehensive Rules sections (`rules/cr/**`) — the sole rules document
 *    included. TRP/PPG/CPG/legality (see categorize.ts's
 *    PROCEDURE_DOCUMENTS) are tournament/event procedure, not adjudication.
 *    Rules Reprise (`rules/reprise/**`) is LSS's per-set worked-example
 *    *commentary*, not the rules text itself, so it is explicitly EXCLUDED
 *    even though categorize.ts buckets both cr and reprise into the same
 *    broad "multi-card-interactions" split category.
 *  - Brain notes documenting a specific card-interaction ruling: a
 *    `ci-`/`ruling-`/`interaction-` slug, or an `"interaction"` tag.
 *    Identity-agnostic — this covers judge's established `ci-*` convention
 *    today, and would cover a future card-vault interaction note the same
 *    way, matching categorize.ts's own identity-agnostic slug/tag matching
 *    for "multi-card-interactions".
 *
 * Deliberately EXCLUDED (documented judgment calls, not oversights):
 *  - An undifferentiated brain rulings/strategy note with no matching
 *    slug/tag (e.g. `combat-chain-steps.md`, `strategy-blocking-basics.md`)
 *    — categorize.ts defaults these into "multi-card-interactions" for
 *    split-stratification purposes, but they aren't curated adjudication
 *    content, so they don't belong in a gate suite whose entire point is
 *    precision.
 *  - lore, and any chunk_id scheme outside `rules/cr/**`/`brain/**`.
 *  - `kw-*` keyword-definition notes (or `"keyword"`-tagged notes): these
 *    ARE adjudication-relevant (a wrong keyword ruling is exactly the kind
 *    of failure this suite exists to catch), but §8.4 already covers them
 *    through a SEPARATE exact-match suite ("keyword definitions" — §8.3's
 *    exact-match branch, distinct from this rubric-graded suite). Including
 *    them here too would double-count the same content across two suites,
 *    so this predicate returns false for them and leaves that coverage to
 *    the exact-match suite.
 *
 * Pure function of (chunkId, tags) — no source-text inspection — mirroring
 * categorize.ts's own cheap/deterministic/stable-across-re-export design.
 * Exported for APP-022's future eval harness to consume directly, and for
 * assemble.ts to record as the `adjudicationCritical` flag on assembled
 * examples so the harness never has to re-derive it.
 */
const INTERACTION_SLUG_RE = /^(ci-|ruling-|interaction-)/;

export function isAdjudicationCritical(chunkId: string, tags: readonly string[]): boolean {
  if (chunkId.startsWith("rules/cr/")) return true;

  if (chunkId.startsWith("brain/")) {
    const slug = chunkId.split("/").pop() ?? "";
    if (INTERACTION_SLUG_RE.test(slug)) return true;
    if (tags.includes("interaction")) return true;
  }

  return false;
}
