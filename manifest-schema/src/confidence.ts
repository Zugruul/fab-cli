import { z } from "zod";

/**
 * §10.2's generation contract (`{answer, citation_ids[], confidence}`) pins
 * confidence to this closed categorical scale. This is the authoritative
 * definition — pipeline/src/behavior/types.ts imports the inferred type
 * rather than declaring its own (BUG-182). "abstain" is reserved for the
 * structured-abstention target (§7.5b) and never appears on an answered
 * example.
 */
export const ConfidenceSchema = z.enum(["high", "medium", "low", "abstain"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;
